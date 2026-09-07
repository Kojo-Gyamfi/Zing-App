import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  runTransaction,
  serverTimestamp,
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
 * Deliberately three writes rather than one batch: security rules on the
 * keys/ subcollection call get() on the parent chat, and inside a batch that
 * get() sees pre-commit state -- the chat would not exist yet and the rule
 * would reject. The chat doc goes first, in a transaction so two people
 * opening the chat simultaneously cannot generate two different keys.
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
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return true;
  });

  if (created) {
    const conversationKey = await createConversationKey();
    await Promise.all([
      setDoc(doc(db(), 'chats', chatId, 'keys', me.uid), {
        sealed: await sealConversationKey(conversationKey, me.identity.publicKey),
      }),
      setDoc(doc(db(), 'chats', chatId, 'keys', peer.uid), {
        sealed: await sealConversationKey(conversationKey, await fromB64(peer.publicKey)),
      }),
    ]);
  }

  return chatId;
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
  const snapshot = await getDoc(doc(db(), 'chats', chatId, 'keys', uid));
  if (!snapshot.exists()) return null;

  const { sealed } = snapshot.data() as { sealed: string };

  // Cached for the service worker, which has to decrypt notification previews
  // while the app is closed and cannot reach Firestore to fetch this.
  void saveSealedKey(chatId, sealed);

  return openConversationKey(sealed, identity);
}

export type ChatSummary = ChatDoc & { id: string };

/** The chat list. Backed by the members array-contains + updatedAt index. */
export function subscribeChats(uid: string, onChange: (chats: ChatSummary[]) => void) {
  return onSnapshot(
    query(
      collection(db(), 'chats'),
      where('members', 'array-contains', uid),
      orderBy('updatedAt', 'desc'),
    ),
    (snapshot) => {
      onChange(
        snapshot.docs.map((entry) => ({
          id: entry.id,
          ...(entry.data({ serverTimestamps: 'estimate' }) as ChatDoc),
        })),
      );
    },
  );
}

/**
 * One write when a chat is opened, rather than a status field per message.
 * The peer's ticks turn teal by comparing message timestamps against this.
 */
export async function markRead(chatId: string, uid: string): Promise<void> {
  await updateDoc(doc(db(), 'chats', chatId), {
    [`lastRead.${uid}`]: serverTimestamp(),
  });
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
        ? { id: snapshot.id, ...(snapshot.data({ serverTimestamps: 'estimate' }) as ChatDoc) }
        : null,
    );
  });
}
