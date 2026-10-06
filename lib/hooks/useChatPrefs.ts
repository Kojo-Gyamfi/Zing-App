'use client';

import { useEffect, useState } from 'react';
import { NO_PREFS, subscribeChatPrefs, type ChatPrefs } from '@/lib/db/prefs';

/**
 * Pinned, muted and archived chats, live -- so a change on one device shows on
 * the others. One read when the list opens, one per change after that.
 */
export function useChatPrefs(uid: string | undefined): ChatPrefs {
  const [prefs, setPrefs] = useState<{ uid: string; prefs: ChatPrefs } | null>(null);

  useEffect(() => {
    if (!uid) return;
    return subscribeChatPrefs(uid, (next) => setPrefs({ uid, prefs: next }));
  }, [uid]);

  // Never another account's preferences, for the moment after switching.
  return prefs && prefs.uid === uid ? prefs.prefs : NO_PREFS;
}
