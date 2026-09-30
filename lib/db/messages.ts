import {
  doc,
  collection,
  query,
  orderBy,
  limit,
  startAfter,
  getDocs,
  onSnapshot,
  writeBatch,
  serverTimestamp,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { seal, open } from '@/lib/crypto/envelope';
import type { Envelope } from '@/lib/crypto/types';
import type { MessageDoc, DecryptedMessage } from './schema';

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

  batch.update(doc(db(), 'chats', params.chatId), {
    lastMessage: {
      ciphertext: envelope.ciphertext,
      nonce: envelope.nonce,
      senderId: params.senderId,
    },
    updatedAt: serverTimestamp(),
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

  return {
    id: entry.id,
    senderId: data.senderId,
    text: await open({ ciphertext: data.ciphertext, nonce: data.nonce }, conversationKey),
    createdAt: data.createdAt?.toDate() ?? null,
    replyTo: data.replyTo ?? null,
    pending: entry.metadata.hasPendingWrites,
  };
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
  lastMessage: { ciphertext: string; nonce: string } | null,
  conversationKey: Uint8Array | null,
): Promise<string | null> {
  if (!lastMessage || !conversationKey) return null;
  return open(lastMessage, conversationKey);
}
