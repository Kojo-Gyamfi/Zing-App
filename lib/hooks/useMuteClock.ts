'use client';

import { useEffect, useState } from 'react';
import { nextMuteExpiry, type MuteState } from '@/lib/mute';

/**
 * "Now", for deciding which chats are muted -- moved on by itself the moment
 * the next timed mute runs out, so the bell goes and the badge comes back
 * without waiting for something else to redraw the list.
 */
export function useMuteClock(state: MuteState): number {
  const [now, setNow] = useState(() => Date.now());
  const next = nextMuteExpiry(state, now);

  useEffect(() => {
    if (next === null) return;
    // setTimeout tops out near 24.8 days; a week-long mute is well inside.
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, next - Date.now()) + 50);
    return () => clearTimeout(timer);
  }, [next]);

  return now;
}
