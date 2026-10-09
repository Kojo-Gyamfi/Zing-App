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
  deleteDoc,
  increment,
  setDoc,
  updateDoc,
  Timestamp,
  arrayUnion,
  arrayRemove,
  documentId,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { seal, open } from '@/lib/crypto/envelope';
import { NOTHING_HIDDEN, type HiddenList } from '@/lib/hidden';
import type { Envelope } from '@/lib/crypto/types';
import {
  MAX_MESSAGE_LENGTH,
  MAX_REACTION_LENGTH,
  type ChatDoc,
  type MessageDoc,
  type MessageListDoc,
  type DecryptedMessage,
} from './schema';

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
  /** Sent with Forward: shows the "Forwarded" label on both sides. */
  forwarded?: boolean;
  /** The chat's disappearing timer, in seconds; 0 or absent for a lasting message. */
  disappearAfter?: number;
}): Promise<{ id: string; envelope: Envelope; committed: Promise<void> }> {
  if (params.text.length > MAX_MESSAGE_LENGTH) throw new Error('MESSAGE_TOO_LONG');
  const envelope = await seal(params.text, params.conversationKey);

  const messageRef = doc(collection(db(), 'chats', params.chatId, 'messages'));
  const batch = writeBatch(db());

  // This device's clock: there is no "server time plus a day" to write. The
  // rules only check it lies in the future, within the longest timer.
  const expiresAt = params.disappearAfter
    ? Timestamp.fromMillis(Date.now() + params.disappearAfter * 1000)
    : null;

  batch.set(messageRef, {
    senderId: params.senderId,
    ciphertext: envelope.ciphertext,
    nonce: envelope.nonce,
    type: 'text',
    createdAt: serverTimestamp(),
    replyTo: params.replyTo ?? null,
    // Only when set, so an ordinary message keeps its usual shape.
    ...(params.forwarded ? { forwarded: true } : {}),
    ...(expiresAt ? { expiresAt } : {}),
  });

  // Chat ids are the two uids sorted and joined, so the recipient needs no lookup.
  const recipient = params.chatId.split('_').find((uid) => uid !== params.senderId);

  batch.update(doc(db(), 'chats', params.chatId), {
    lastMessage: {
      id: messageRef.id,
      ciphertext: envelope.ciphertext,
      nonce: envelope.nonce,
      senderId: params.senderId,
      ...(expiresAt ? { expiresAt } : {}),
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
    reactions: deleted ? {} : await openReactions(data.reactions, conversationKey),
    forwarded: !deleted && data.forwarded === true,
    expiresAt: asDate(data.expiresAt),
  };
}

function asDate(value: unknown): Date | null {
  const ms = timestampMs(value);
  return ms === null ? null : new Date(ms);
}

/**
 * Milliseconds from a Firestore Timestamp, or null for anything else. For
 * fields another client wrote: a value that is not a Timestamp must read as
 * "none", not throw inside a list build.
 */
export function timestampMs(value: unknown): number | null {
  const toMillis = (value as { toMillis?: unknown } | null | undefined)?.toMillis;
  return typeof toMillis === 'function' ? (toMillis.call(value) as number) : null;
}

/**
 * How long past its expiry a message is left before this device deletes it.
 * Hiding uses this device's clock; deleting is judged by the server's, and a
 * phone running fast would otherwise be refused (and, in the sweep, take the
 * rest of that chat's batch down with it).
 */
export const DELETE_SLACK_MS = 2 * 60 * 1000;

/** A disappearing message whose time is up. Hidden everywhere from that moment. */
export function hasExpired(message: { expiresAt?: Date | null }, now = Date.now()): boolean {
  return message.expiresAt != null && message.expiresAt.getTime() <= now;
}

/**
 * Delete an expired message outright -- not a tombstone: nothing about it
 * needs to survive. Any member may, but only once it has expired (the rules
 * check), so whichever device notices first does the job. Firestore's TTL
 * policies would do this server-side, but they need billing enabled.
 */
export async function removeExpiredMessage(chatId: string, messageId: string): Promise<void> {
  await deleteDoc(doc(db(), 'chats', chatId, 'messages', messageId));
}

/**
 * The sender's sweep: every message this user sent that has expired, across
 * all chats, deleted. Run once a session from the chat list, so a chat nobody
 * reopens still loses its expired messages. A page at a time; anything left
 * goes next session.
 */
export async function sweepExpiredMessages(uid: string): Promise<void> {
  const expired = await getDocs(
    query(
      collectionGroup(db(), 'messages'),
      where('senderId', '==', uid),
      where('expiresAt', '<=', Timestamp.fromMillis(Date.now() - DELETE_SLACK_MS)),
      limit(200),
    ),
  );
  // One batch per chat: each delete's rule reads its chat doc, and a batch
  // spanning many chats would run past the rules' cap on document reads.
  const byChat = new Map<string, QueryDocumentSnapshot[]>();
  for (const entry of expired.docs) {
    const chatId = entry.ref.parent.parent!.id;
    byChat.set(chatId, [...(byChat.get(chatId) ?? []), entry]);
  }
  await Promise.allSettled(
    [...byChat.values()].map((entries) => {
      const batch = writeBatch(db());
      entries.forEach((entry) => batch.delete(entry.ref));
      return batch.commit();
    }),
  );
}

/**
 * Strip the list preview of a disappearing message that has expired. Any
 * member may (the rules check it has expired and that only the ciphertext
 * goes), so it is gone from the chat doc even if the sender never comes back.
 */
export async function clearExpiredPreview(
  chatId: string,
  lastMessage: NonNullable<ChatDoc['lastMessage']>,
): Promise<void> {
  if (!lastMessage.expiresAt) return;
  await updateDoc(doc(db(), 'chats', chatId), {
    lastMessage: {
      ...(lastMessage.id ? { id: lastMessage.id } : {}),
      senderId: lastMessage.senderId,
      expiresAt: lastMessage.expiresAt,
    },
  });
}

/** What the list shows for a disappearing message once it has gone. */
export const EXPIRED_LABEL = 'Message disappeared';

async function openReactions(
  sealed: MessageDoc['reactions'],
  conversationKey: Uint8Array,
): Promise<Record<string, string>> {
  if (!sealed) return {};
  const opened = await Promise.all(
    Object.entries(sealed).map(async ([uid, envelope]) => {
      const emoji = envelope?.ciphertext && envelope.nonce ? await open(envelope, conversationKey) : null;
      // Anything longer than one emoji did not come from this app.
      return emoji && emoji.length <= MAX_REACTION_LENGTH ? ([uid, emoji] as const) : null;
    }),
  );
  return Object.fromEntries(opened.filter((entry) => entry !== null));
}

/**
 * React to a message, or take a reaction back (emoji null). One reaction per
 * member: a new one replaces the old. The rules let each member write only
 * their own entry.
 */
export async function setReaction(params: {
  chatId: string;
  messageId: string;
  uid: string;
  emoji: string | null;
  conversationKey: Uint8Array;
}): Promise<void> {
  if (params.emoji !== null && params.emoji.length > MAX_REACTION_LENGTH) {
    throw new Error('REACTION_TOO_LONG');
  }
  await updateDoc(doc(db(), 'chats', params.chatId, 'messages', params.messageId), {
    [`reactions.${params.uid}`]:
      params.emoji === null ? deleteField() : await seal(params.emoji, params.conversationKey),
  });
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
  /** The message's own expiry, kept on the rewritten preview. */
  expiresAt?: Date | null;
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
      lastMessage: {
        id: params.messageId,
        senderId: params.senderId,
        ...envelope,
        // Without it the preview would outlive the message: never shown as
        // gone, and its ciphertext never stripped.
        ...(params.expiresAt ? { expiresAt: Timestamp.fromDate(params.expiresAt) } : {}),
      },
    });
  }

  await batch.commit();
}

/**
 * Delete for everyone. The doc stays as a tombstone -- so replies to it and
 * pagination keep working -- but the ciphertext and nonce are removed, so there
 * is nothing left in Firestore to decrypt even for someone holding the key.
 * Reactions go with it.
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
    reactions: deleteField(),
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

function toHiddenList(data: Partial<MessageListDoc> | undefined): HiddenList {
  return {
    ids: new Set(data?.ids ?? []),
    clearedAt: data?.clearedAt instanceof Timestamp ? data.clearedAt.toDate() : null,
  };
}

export function subscribeHidden(
  chatId: string,
  uid: string,
  onChange: (hidden: HiddenList) => void,
) {
  return onSnapshot(
    hiddenRef(chatId, uid),
    (snapshot) => {
      // A pending clearedAt reads as "now" rather than null, so a cleared
      // chat empties at once instead of after the server answers.
      const data = snapshot.data({ serverTimestamps: 'estimate' }) as Partial<MessageListDoc> | undefined;
      onChange(toHiddenList(data));
      // Lists written before they named their owner are invisible to
      // subscribeAllHidden; stamp them the first time they are seen.
      if (snapshot.exists() && !snapshot.metadata.fromCache && snapshot.data().uid !== uid) {
        void setDoc(hiddenRef(chatId, uid), { uid }, { merge: true }).catch(() => undefined);
      }
    },
    // Rules not deployed yet, or offline with nothing cached: hide nothing.
    () => onChange(NOTHING_HIDDEN),
  );
}

/**
 * "Clear chat", for this member only: every message so far is gone from their
 * account on every device, as on WhatsApp. The other person keeps theirs, and
 * the messages themselves are untouched -- they are the other person's too.
 *
 * One stamp of the server's clock rather than a list of ids, so it costs one
 * write however long the chat is, and the rules only accept "now", so it
 * cannot be wound back. Single hides before it are covered by it, so the list
 * starts again empty. Stars in the chat go too: they would point at nothing.
 */
export async function clearChat(chatId: string, uid: string): Promise<void> {
  const batch = writeBatch(db());
  batch.set(hiddenRef(chatId, uid), { uid, ids: [], clearedAt: serverTimestamp() });
  batch.delete(starredRef(chatId, uid));
  await batch.commit();
}

export async function hideMessage(chatId: string, uid: string, messageId: string): Promise<void> {
  await setDoc(hiddenRef(chatId, uid), { uid, ids: arrayUnion(messageId) }, { merge: true });
}

/**
 * Starred messages: the same shape as "Delete for me" -- ids only, one list per
 * member per chat, private to that member. The Starred screen finds every list
 * with one collection-group query and decrypts the messages on the device.
 */
const starredRef = (chatId: string, uid: string) => doc(db(), 'chats', chatId, 'starred', uid);

export function subscribeStarred(
  chatId: string,
  uid: string,
  onChange: (ids: Set<string>) => void,
) {
  return onSnapshot(
    starredRef(chatId, uid),
    (snapshot) => onChange(new Set((snapshot.data()?.ids as string[] | undefined) ?? [])),
    () => onChange(new Set()),
  );
}

export async function setStarred(
  chatId: string,
  uid: string,
  messageId: string,
  starred: boolean,
): Promise<void> {
  await setDoc(
    starredRef(chatId, uid),
    { uid, ids: starred ? arrayUnion(messageId) : arrayRemove(messageId) },
    { merge: true },
  );
}

export type StarredMessage = DecryptedMessage & { chatId: string };

/**
 * Every message this person starred, newest first, decrypted locally. One
 * query for the lists, then the messages themselves 30 at a time (Firestore's
 * cap on an `in` filter). Reads scale with the number of stars, and only when
 * the Starred screen is opened.
 */
export async function loadStarredMessages(
  uid: string,
  keyFor: (chatId: string) => Promise<Uint8Array | null>,
): Promise<StarredMessage[]> {
  const lists = await getDocs(query(collectionGroup(db(), 'starred'), where('uid', '==', uid)));

  const perChat = await Promise.all(
    lists.docs.map(async (list) => {
      const chatId = list.ref.parent.parent!.id;
      const ids = (list.data() as MessageListDoc).ids ?? [];
      const key = ids.length ? await keyFor(chatId) : null;
      if (!key) return [];

      const pages = await Promise.all(
        Array.from({ length: Math.ceil(ids.length / 30) }, (_, page) =>
          getDocs(
            query(
              collection(db(), 'chats', chatId, 'messages'),
              where(documentId(), 'in', ids.slice(page * 30, page * 30 + 30)),
            ),
          ),
        ),
      );
      return Promise.all(
        pages
          .flatMap((snapshot) => snapshot.docs)
          .map(async (entry) => ({ ...(await decrypt(entry, key)), chatId })),
      );
    }),
  );

  return perChat
    .flat()
    .filter((message) => !hasExpired(message))
    .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
}

/**
 * Every "Delete for me" list this user has, across all chats, in one query --
 * the chat list needs them so a hidden newest message is not the preview.
 * Keyed by chat id.
 */
export function subscribeAllHidden(uid: string, onChange: (hidden: Map<string, HiddenList>) => void) {
  return onSnapshot(
    query(collectionGroup(db(), 'hidden'), where('uid', '==', uid)),
    (snapshot) => {
      onChange(
        new Map(
          snapshot.docs.map((entry) => [
            entry.ref.parent.parent!.id,
            toHiddenList(entry.data({ serverTimestamps: 'estimate' }) as Partial<MessageListDoc>),
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
  hidden: HiddenList,
): Promise<DecryptedMessage | null> {
  if (!conversationKey) return null;
  const snapshot = await getDocs(
    query(
      collection(db(), 'chats', chatId, 'messages'),
      ...(hidden.clearedAt ? [where('createdAt', '>', hidden.clearedAt)] : []),
      orderBy('createdAt', 'desc'),
      limit(PAGE_SIZE),
    ),
  );
  const entry = snapshot.docs.find(
    (candidate) =>
      !hidden.ids.has(candidate.id) && !hasExpired({ expiresAt: asDate(candidate.data().expiresAt) }),
  );
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
  // Snapshots come in bursts (metadata changes too) and each decrypts
  // asynchronously, some slower than others; only the newest may land, or an
  // older one finishing late would put back a clock icon already gone.
  let latest = 0;
  return onSnapshot(
    query(
      collection(db(), 'chats', chatId, 'messages'),
      orderBy('createdAt', 'desc'),
      limit(PAGE_SIZE),
    ),
    { includeMetadataChanges: true },
    (snapshot) => {
      const mine = ++latest;
      Promise.all(snapshot.docs.map((entry) => decrypt(entry, conversationKey))).then(
        (messages) => {
          if (mine === latest) onChange(messages.reverse());
        },
        // libsodium failing to load, say: say so rather than spin forever.
        (error: unknown) => {
          if (mine === latest) onError?.(error instanceof Error ? error : new Error(String(error)));
        },
      );
    },
    (error) => onError?.(error),
  );
}

/**
 * Scroll-up pagination. Messages come oldest-first, like the live page.
 * `fromCache` is true when this came from the offline cache -- a short page
 * then means "not cached", not "the start of the chat".
 */
export async function loadOlderMessages(
  chatId: string,
  conversationKey: Uint8Array,
  before: Date,
  /** "Clear chat": nothing at or before this is wanted, so it is not fetched. */
  after: Date | null = null,
): Promise<{ messages: DecryptedMessage[]; fromCache: boolean }> {
  const snapshot = await getDocs(
    query(
      collection(db(), 'chats', chatId, 'messages'),
      ...(after ? [where('createdAt', '>', after)] : []),
      orderBy('createdAt', 'desc'),
      startAfter(before),
      limit(PAGE_SIZE),
    ),
  );

  const messages = await Promise.all(
    snapshot.docs.map((entry) => decrypt(entry, conversationKey)),
  );
  return { messages: messages.reverse(), fromCache: snapshot.metadata.fromCache };
}

/** Decrypt a chat-list preview. */
export async function decryptPreview(
  lastMessage: ChatDoc['lastMessage'],
  conversationKey: Uint8Array | null,
): Promise<string | null> {
  const expiresAt = timestampMs(lastMessage?.expiresAt);
  if (expiresAt !== null && expiresAt <= Date.now()) return EXPIRED_LABEL;
  if (lastMessage?.deleted) return DELETED_LABEL;
  if (!lastMessage?.ciphertext || !lastMessage.nonce || !conversationKey) return null;
  return open({ ciphertext: lastMessage.ciphertext, nonce: lastMessage.nonce }, conversationKey);
}
