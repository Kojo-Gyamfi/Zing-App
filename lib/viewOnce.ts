/**
 * View once: a message the recipient can open a single time. Opening it
 * wipes its ciphertext from the server (the rules let only the recipient do
 * that, and only to a view-once message), so it is gone from every device,
 * theirs and the sender's alike, and from any later backup of the chat.
 *
 * The text never goes into the chat-list preview or a push notification,
 * where it would outlive the opening. Copy, forward, star and edit are off
 * for it. A screenshot still works; the UI says so rather than pretend.
 */
export const VIEW_ONCE_LABEL = 'View once message';

export type ViewOnceState =
  /** Not a view-once message. */
  | 'none'
  /** Mine, sent: I see that it went, never the text again. */
  | 'sent'
  /** Theirs, not opened yet: tap to open. */
  | 'ready'
  /** Opened -- by them, or by me if it was theirs. Nothing left to show. */
  | 'opened';

export function viewOnceState(
  message: { viewOnce?: boolean; viewed?: boolean; text: string | null; deleted: boolean },
  mine: boolean,
): ViewOnceState {
  if (!message.viewOnce || message.deleted) return 'none';
  if (message.viewed || (!mine && message.text === null)) return 'opened';
  return mine ? 'sent' : 'ready';
}
