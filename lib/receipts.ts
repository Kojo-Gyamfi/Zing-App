/**
 * When to write a delivery or read receipt.
 *
 * Both receipts are serverTimestamp() writes to the chat doc, and while such a
 * write is unconfirmed Firestore reports this device's clock in its place. A
 * device running even slightly behind the server then sees its own receipt as
 * older than the message, decides it still owes one, writes again -- and
 * repeats until the server answers. That loop used a day's free quota in an
 * afternoon of testing. Every rule below exists to make it impossible.
 */

export function needsDeliveryReceipt(params: {
  me: string;
  /** The chat doc has local writes the server has not confirmed. */
  pending: boolean;
  lastSenderId: string | null;
  updatedAt: Date | null;
  deliveredAt: Date | null;
  /** updatedAt (ms) we already sent a receipt for, this session. */
  acknowledged: number | undefined;
}): boolean {
  const { me, pending, lastSenderId, updatedAt, deliveredAt, acknowledged } = params;

  if (pending) return false;
  if (lastSenderId === null || lastSenderId === me) return false;
  if (updatedAt === null) return false;
  if (acknowledged === updatedAt.getTime()) return false;
  return deliveredAt === null || updatedAt > deliveredAt;
}

/**
 * Whether a chat shows as unread in the list. The badge counter decides when
 * the chat has one: it is cleared on opening whether or not read receipts are
 * on, while lastRead is never written with them off. Older chats with no
 * counter yet fall back to "anything newer than my last open".
 */
export function isUnread(params: {
  me: string;
  lastSenderId: string | null;
  /** unread.{me} on the chat doc; undefined on chats from before the counter. */
  count: number | undefined;
  updatedAt: Date | null;
  readAt: Date | null;
}): boolean {
  const { me, lastSenderId, count, updatedAt, readAt } = params;

  if (lastSenderId === null || lastSenderId === me) return false;
  if (count !== undefined) return count > 0;
  return readAt === null || (updatedAt !== null && updatedAt > readAt);
}

export function needsReadReceipt(params: {
  /** Newest message from the other person, if any is loaded. */
  newestIncoming: { id: string; createdAt: Date | null } | undefined;
  /** My lastRead as the server has it; undefined until known. */
  readAt: Date | null | undefined;
  /** Message id we already sent a read receipt for, this session. */
  marked: string | null;
}): boolean {
  const { newestIncoming, readAt, marked } = params;

  if (readAt === undefined || !newestIncoming?.createdAt) return false;
  if (marked === newestIncoming.id) return false;
  return readAt === null || newestIncoming.createdAt > readAt;
}
