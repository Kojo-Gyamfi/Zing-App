import {
  doc,
  getDoc,
  getDocFromCache,
  updateDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { createConversationKey, sealConversationKey, openConversationKey } from '@/lib/crypto/chat';
import { fromB64 } from '@/lib/crypto/codec';
import { saveSealedKey } from '@/lib/crypto/vault';
import type { Identity } from '@/lib/crypto/types';
import type { ChatDoc, UserDoc } from './schema';

/**
 * Direct chats use a deterministic id built from the two uids, so the same
 * pair can never end up with two parallel conversations no matter who opens
 * it first.
 */
export function directChatId(a: string, b: string): string {
  return [a, b].sort().join('_');
}

/**
 * Create the chat and seal its conversation key to both members.
 *
 * Deliberately two commits rather than one batch: security rules on the
 * keys/ subcollection call get() on the parent chat, and inside a batch that
 * get() sees pre-commit state -- the chat would not exist yet and the rule
 * would reject. The chat doc goes first, in a transaction so two people
 * opening the chat simultaneously cannot generate two different keys; then
 * both key copies, together.
 */
export async function ensureDirectChat(
  me: { uid: string; identity: Identity },
  peer: UserDoc,
): Promise<string> {
  const chatId = directChatId(me.uid, peer.uid);
  const chatRef = doc(db(), 'chats', chatId);

  const created = await runTransaction(db(), async (transaction) => {
    if ((await transaction.get(chatRef)).exists()) return false;

    transaction.set(chatRef, {
      members: [me.uid, peer.uid].sort(),
      lastMessage: null,
      lastRead: {},
      lastDelivered: {},
      unread: {},
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return true;
  });

  if (created) {
    await writeKeys(chatId, me, peer);
  } else {
    // A chat whose keys never landed (the tab closed between the chat and its
    // keys, under the old two-write version) would spin on "Decrypting"
    // forever. If my copy is missing and nothing has been sent under any key
    // yet, it is safe to make one now: the rules refuse to overwrite a key
    // doc, so this can never replace a key that is in use.
    const [mine, chat] = await Promise.all([
      getDoc(doc(db(), 'chats', chatId, 'keys', me.uid)),
      getDoc(chatRef),
    ]);
    if (!mine.exists() && !chat.data()?.lastMessage) await writeKeys(chatId, me, peer);
  }

  return chatId;
}

/**
 * One new conversation key, sealed to both members, written in one batch so
 * the two copies land together or not at all. The chat doc is committed by
 * now, so the rules' get() on it passes.
 *
 * Losing a race to the other member (they wrote the keys first) refuses the
 * batch; that is fine as long as my copy exists afterwards.
 */
async function writeKeys(
  chatId: string,
  me: { uid: string; identity: Identity },
  peer: UserDoc,
): Promise<void> {
  const conversationKey = await createConversationKey();
  const [mineSealed, theirsSealed] = await Promise.all([
    sealConversationKey(conversationKey, me.identity.publicKey),
    fromB64(peer.publicKey).then((key) => sealConversationKey(conversationKey, key)),
  ]);

  const batch = writeBatch(db());
  batch.set(doc(db(), 'chats', chatId, 'keys', me.uid), { sealed: mineSealed });
  batch.set(doc(db(), 'chats', chatId, 'keys', peer.uid), { sealed: theirsSealed });
  try {
    await batch.commit();
  } catch (cause) {
    const mine = await getDoc(doc(db(), 'chats', chatId, 'keys', me.uid)).catch(() => null);
    if (!mine?.exists()) throw cause;
  }
}

/**
 * Fetch and unseal this chat's conversation key.
 *
 * Null means the key document is not there yet -- the other side created the
 * chat microseconds ago and is still writing our copy. Callers show a
 * "securing this chat" state and let the listener retry rather than erroring.
 */
export async function loadConversationKey(
  chatId: string,
  uid: string,
  identity: Identity,
): Promise<Uint8Array | null> {
  const ref = doc(db(), 'chats', chatId, 'keys', uid);
  // Key docs never change -- the rules refuse every update and delete -- so a
  // copy in the offline cache is as good as the server's, and costs no read.
  // Only a key this device has never fetched goes to the network.
  const cached = await getDocFromCache(ref).catch(() => null);
  const snapshot = cached?.exists() ? cached : await getDoc(ref);
  if (!snapshot.exists()) return null;

  const { sealed } = snapshot.data() as { sealed: string };

  // Cached for the service worker, which has to decrypt notification previews
  // while the app is closed and cannot reach Firestore to fetch this.
  void saveSealedKey(chatId, sealed);

  return openConversationKey(sealed, identity);
}

export type ChatSummary = ChatDoc & {
  id: string;
  /** Local writes not yet confirmed; their timestamps are this device's guess. */
  pending: boolean;
};

/** How many chats the list loads at a time. */
export const CHAT_PAGE_SIZE = 50;

/**
 * The newest `max` chats, live. Backed by the members array-contains +
 * updatedAt index. The list raises `max` a page at a time as it is scrolled,
 * so a long-time user does not pull every conversation they ever had on each
 * launch. `hasMore` is a guess: a full page means there may be another.
 */
export function subscribeChats(
  uid: string,
  max: number,
  onChange: (chats: ChatSummary[], hasMore: boolean) => void,
  onError?: () => void,
) {
  return onSnapshot(
    query(
      collection(db(), 'chats'),
      where('members', 'array-contains', uid),
      orderBy('updatedAt', 'desc'),
      limit(max),
    ),
    (snapshot) => {
      onChange(
        snapshot.docs.map((entry) => ({
          id: entry.id,
          ...(entry.data({ serverTimestamps: 'estimate' }) as ChatDoc),
          pending: entry.metadata.hasPendingWrites,
        })),
        snapshot.size >= max,
      );
    },
    () => onError?.(),
  );
}

/**
 * One write when a chat is opened, rather than a status field per message.
 * The peer's ticks turn teal by comparing message timestamps against this.
 */
export async function markRead(chatId: string, uid: string): Promise<void> {
  await updateDoc(doc(db(), 'chats', chatId), {
    [`lastRead.${uid}`]: serverTimestamp(),
    [`unread.${uid}`]: 0,
  });
}

/**
 * markRead for someone with read receipts turned off: their badge clears, but
 * lastRead -- the other person's blue ticks -- is never written.
 */
export async function clearUnread(chatId: string, uid: string): Promise<void> {
  await updateDoc(doc(db(), 'chats', chatId), { [`unread.${uid}`]: 0 });
}

/**
 * The second tick. Written whenever the chat list -- which is subscribed for
 * as long as the app is open -- sees a message it has not acknowledged, so
 * delivery is recorded without the recipient opening the conversation.
 */
export async function markDelivered(chatId: string, uid: string): Promise<void> {
  await updateDoc(doc(db(), 'chats', chatId), {
    [`lastDelivered.${uid}`]: serverTimestamp(),
  });
}

/** Live receipts for one conversation, so ticks update as the peer reads. */
export function subscribeChat(chatId: string, onChange: (chat: ChatSummary | null) => void) {
  return onSnapshot(doc(db(), 'chats', chatId), (snapshot) => {
    onChange(
      snapshot.exists()
        ? {
            id: snapshot.id,
            ...(snapshot.data({ serverTimestamps: 'estimate' }) as ChatDoc),
            pending: snapshot.metadata.hasPendingWrites,
          }
        : null,
    );
  });
}

/**
 * Calls back once this member's key doc exists. For a chat opened before the
 * other side finished writing it -- the chat doc lands first, by design (see
 * ensureDirectChat) -- so the thread can unlock the moment the key arrives.
 */
export function onConversationKeyReady(chatId: string, uid: string, onReady: () => void) {
  return onSnapshot(
    doc(db(), 'chats', chatId, 'keys', uid),
    (snapshot) => {
      if (snapshot.exists()) onReady();
    },
    () => undefined,
  );
}
