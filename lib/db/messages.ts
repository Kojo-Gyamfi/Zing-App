import {
  doc,
  collection,
  collectionGroup,
  where,
  query,
  orderBy,
  limit,
  startAfter,
  getDocs,
  onSnapshot,
  writeBatch,
  serverTimestamp,
  deleteField,
  increment,
  setDoc,
  arrayUnion,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { seal, open } from '@/lib/crypto/envelope';
import type { Envelope } from '@/lib/crypto/types';
import { MAX_MESSAGE_LENGTH, type MessageDoc, type DecryptedMessage } from './schema';

export const PAGE_SIZE = 30;

/**
 * Send a message.
 *
 * The batch writes the message and moves the chat's lastMessage/updatedAt
 * together, so the chat list can never show a preview that disagrees with the
 * thread. lastMessage is encrypted with the same conversation key -- the list
 * decrypts previews client-side.
 *
 * We do not await the commit before returning: Firestore's local cache fires
 * the snapshot listener immediately, so the bubble is on screen before the
 * write leaves the device. Offline, it simply queues and flushes on reconnect.
 *
 * `committed` settles once the server has answered. It stays pending while
 * offline and only rejects when the write is refused -- at which point the
 * local copy is rolled back and the caller must show the message as failed,
 * or it silently disappears.
 */
export async function sendMessage(params: {
  chatId: string;
  senderId: string;
  text: string;
  conversationKey: Uint8Array;
  replyTo?: string | null;
}): Promise<{ id: string; envelope: Envelope; committed: Promise<void> }> {
  if (params.text.length > MAX_MESSAGE_LENGTH) throw new Error('MESSAGE_TOO_LONG');
  const envelope = await seal(params.text, params.conversationKey);

  const messageRef = doc(collection(db(), 'chats', params.chatId, 'messages'));
  const batch = writeBatch(db());

  batch.set(messageRef, {
    senderId: params.senderId,
    ciphertext: envelope.ciphertext,
    nonce: envelope.nonce,
    type: 'text',
    createdAt: serverTimestamp(),
    replyTo: params.replyTo ?? null,
  });

  // Chat ids are the two uids sorted and joined, so the recipient needs no lookup.
  const recipient = params.chatId.split('_').find((uid) => uid !== params.senderId);

  batch.update(doc(db(), 'chats', params.chatId), {
    lastMessage: {
      id: messageRef.id,
      ciphertext: envelope.ciphertext,
      nonce: envelope.nonce,
      senderId: params.senderId,
    },
    updatedAt: serverTimestamp(),
    // The recipient's unread badge. markRead puts it back to zero.
    ...(recipient ? { [`unread.${recipient}`]: increment(1) } : {}),
    // Both members having sent something is what unlocks phone numbers.
    [`sent.${params.senderId}`]: true,
  });

  return { id: messageRef.id, envelope, committed: batch.commit() };
}

async function decrypt(
  entry: QueryDocumentSnapshot,
  conversationKey: Uint8Array,
): Promise<DecryptedMessage> {
  // 'estimate' gives pending writes a local timestamp instead of null, which
  // keeps optimistic messages in the right order until the server confirms.
  const data = entry.data({ serverTimestamps: 'estimate' }) as MessageDoc;

  const deleted = data.deleted === true;

  return {
    id: entry.id,
    senderId: data.senderId,
    text:
      deleted || !data.ciphertext || !data.nonce
        ? null
        : await open({ ciphertext: data.ciphertext, nonce: data.nonce }, conversationKey),
    createdAt: data.createdAt?.toDate() ?? null,
    replyTo: data.replyTo ?? null,
    edited: !deleted && Boolean(data.editedAt),
    deleted,
    pending: entry.metadata.hasPendingWrites,
  };
}

/**
 * Replace a message's text. The new text is sealed afresh -- new nonce, same
 * conversation key -- so the server sees only that the ciphertext changed.
 *
 * `isLatest` comes from the thread the caller is looking at. When the edited
 * message is the newest one, the chat-list preview is rewritten in the same
 * batch so the two cannot disagree. updatedAt is left alone: an edit is not new
 * mail and must not bump the chat or mark it unread.
 */
export async function editMessage(params: {
  chatId: string;
  messageId: string;
  senderId: string;
  text: string;
  conversationKey: Uint8Array;
  isLatest: boolean;
}): Promise<void> {
  if (params.text.length > MAX_MESSAGE_LENGTH) throw new Error('MESSAGE_TOO_LONG');
  const envelope = await seal(params.text, params.conversationKey);
  const batch = writeBatch(db());

  batch.update(doc(db(), 'chats', params.chatId, 'messages', params.messageId), {
    ciphertext: envelope.ciphertext,
    nonce: envelope.nonce,
    editedAt: serverTimestamp(),
  });

  if (params.isLatest) {
    batch.update(doc(db(), 'chats', params.chatId), {
      lastMessage: { id: params.messageId, senderId: params.senderId, ...envelope },
    });
  }

  await batch.commit();
}

/**
 * Delete for everyone. The doc stays as a tombstone -- so replies to it and
 * pagination keep working -- but the ciphertext and nonce are removed, so there
 * is nothing left in Firestore to decrypt even for someone holding the key.
 */
export async function deleteMessage(params: {
  chatId: string;
  messageId: string;
  senderId: string;
  isLatest: boolean;
}): Promise<void> {
  const batch = writeBatch(db());

  batch.update(doc(db(), 'chats', params.chatId, 'messages', params.messageId), {
    ciphertext: deleteField(),
    nonce: deleteField(),
    deleted: true,
    deletedAt: serverTimestamp(),
  });

  if (params.isLatest) {
    batch.update(doc(db(), 'chats', params.chatId), {
      lastMessage: { id: params.messageId, senderId: params.senderId, deleted: true },
    });
  }

  await batch.commit();
}

export const DELETED_LABEL = 'This message was deleted';

/**
 * "Delete for me": message ids this user has hidden in one chat.
 *
 * Stored in Firestore rather than on the device so the choice follows the
 * account to a new phone. Only ids -- the message itself is untouched and the
 * other person still has it.
 */
const hiddenRef = (chatId: string, uid: string) => doc(db(), 'chats', chatId, 'hidden', uid);

export function subscribeHidden(
  chatId: string,
  uid: string,
  onChange: (ids: Set<string>) => void,
) {
  return onSnapshot(
    hiddenRef(chatId, uid),
    (snapshot) => {
      onChange(new Set((snapshot.data()?.ids as string[] | undefined) ?? []));
      // Lists written before they named their owner are invisible to
      // subscribeAllHidden; stamp them the first time they are seen.
      if (snapshot.exists() && !snapshot.metadata.fromCache && snapshot.data().uid !== uid) {
        void setDoc(hiddenRef(chatId, uid), { uid }, { merge: true }).catch(() => undefined);
      }
    },
    // Rules not deployed yet, or offline with nothing cached: hide nothing.
    () => onChange(new Set()),
  );
}

export async function hideMessage(chatId: string, uid: string, messageId: string): Promise<void> {
  await setDoc(hiddenRef(chatId, uid), { uid, ids: arrayUnion(messageId) }, { merge: true });
}

/**
 * Every "Delete for me" list this user has, across all chats, in one query --
 * the chat list needs them so a hidden newest message is not the preview.
 * Keyed by chat id.
 */
export function subscribeAllHidden(uid: string, onChange: (hidden: Map<string, Set<string>>) => void) {
  return onSnapshot(
    query(collectionGroup(db(), 'hidden'), where('uid', '==', uid)),
    (snapshot) => {
      onChange(
        new Map(
          snapshot.docs.map((entry) => [
            entry.ref.parent.parent!.id,
            new Set((entry.data().ids as string[] | undefined) ?? []),
          ]),
        ),
      );
    },
    () => onChange(new Map()),
  );
}

/**
 * The newest message in a chat that this user has not hidden, decrypted --
 * the list preview when the real newest one was deleted for me. Looks back a
 * page at most; past that, no preview.
 */
export async function latestVisibleMessage(
  chatId: string,
  conversationKey: Uint8Array | null,
  hidden: Set<string>,
): Promise<DecryptedMessage | null> {
  if (!conversationKey) return null;
  const snapshot = await getDocs(
    query(collection(db(), 'chats', chatId, 'messages'), orderBy('createdAt', 'desc'), limit(PAGE_SIZE)),
  );
  const entry = snapshot.docs.find((candidate) => !hidden.has(candidate.id));
  return entry ? decrypt(entry, conversationKey) : null;
}

/**
 * Live subscription to the most recent page of a thread.
 *
 * includeMetadataChanges matters: it is what tells us the moment a pending
 * write is acknowledged, which is how a clock icon becomes a single tick.
 */
export function subscribeMessages(
  chatId: string,
  conversationKey: Uint8Array,
  onChange: (messages: DecryptedMessage[]) => void,
  onError?: (error: Error) => void,
) {
  return onSnapshot(
    query(
      collection(db(), 'chats', chatId, 'messages'),
      orderBy('createdAt', 'desc'),
      limit(PAGE_SIZE),
    ),
    { includeMetadataChanges: true },
    (snapshot) => {
      void Promise.all(snapshot.docs.map((entry) => decrypt(entry, conversationKey)))
        .then((messages) => onChange(messages.reverse()));
    },
    (error) => onError?.(error),
  );
}

/** Scroll-up pagination. Returns oldest-first, like the live page. */
export async function loadOlderMessages(
  chatId: string,
  conversationKey: Uint8Array,
  before: Date,
): Promise<DecryptedMessage[]> {
  const snapshot = await getDocs(
    query(
      collection(db(), 'chats', chatId, 'messages'),
      orderBy('createdAt', 'desc'),
      startAfter(before),
      limit(PAGE_SIZE),
    ),
  );

  const messages = await Promise.all(
    snapshot.docs.map((entry) => decrypt(entry, conversationKey)),
  );
  return messages.reverse();
}

/** Decrypt a chat-list preview. */
export async function decryptPreview(
  lastMessage: { ciphertext?: string; nonce?: string; deleted?: boolean } | null,
  conversationKey: Uint8Array | null,
): Promise<string | null> {
  if (lastMessage?.deleted) return DELETED_LABEL;
  if (!lastMessage?.ciphertext || !lastMessage.nonce || !conversationKey) return null;
  return open({ ciphertext: lastMessage.ciphertext, nonce: lastMessage.nonce }, conversationKey);
}
