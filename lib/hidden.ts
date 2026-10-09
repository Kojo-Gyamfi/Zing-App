/**
 * What one member has removed from a chat: single messages ("Delete for me")
 * and, after "Clear chat", everything sent up to `clearedAt`. Stored at
 * chats/{chatId}/hidden/{uid}; see lib/db/messages.ts.
 */
export type HiddenList = { ids: Set<string>; clearedAt: Date | null };

export const NOTHING_HIDDEN: HiddenList = { ids: new Set(), clearedAt: null };

/**
 * Whether a message is gone for this member. A message still on its way has
 * no server time yet; it was sent after any clear, so it stays.
 */
export function isHidden(
  message: { id: string; createdAt: Date | null },
  hidden: HiddenList,
): boolean {
  if (hidden.ids.has(message.id)) return true;
  return (
    hidden.clearedAt !== null &&
    message.createdAt !== null &&
    message.createdAt.getTime() <= hidden.clearedAt.getTime()
  );
}
