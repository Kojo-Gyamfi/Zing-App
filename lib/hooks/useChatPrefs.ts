'use client';

import { NO_PREFS, type ChatPrefs } from '@/lib/db/prefs';
import { useAccount } from '@/lib/store/account';

/**
 * Pinned, muted and archived chats, live -- so a change on one device shows on
 * the others. Read from the account listener the session keeps open, so this
 * costs no reads of its own.
 */
export function useChatPrefs(uid: string | undefined): ChatPrefs {
  // Never another account's preferences, for the moment after switching.
  return useAccount((state) => (uid && state.owner === uid ? state.settings.prefs : NO_PREFS));
}
