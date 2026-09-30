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
