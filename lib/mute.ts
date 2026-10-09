/**
 * Muting a chat for a while or for good, as on WhatsApp. "Always" is the
 * chat id in the account doc's `muted` list (as before timed mutes existed);
 * a timed mute is `mutedUntil.{chatId}`, a time. The push route checks both,
 * so a muted chat gets no push at all -- see app/api/push/send/route.ts.
 */
export type MuteDuration = '8h' | '1w' | 'always';

export const MUTE_CHOICES: { value: MuteDuration; label: string }[] = [
  { value: '8h', label: '8 hours' },
  { value: '1w', label: '1 week' },
  { value: 'always', label: 'Always' },
];

const HOUR = 60 * 60 * 1000;
const LENGTHS: Record<Exclude<MuteDuration, 'always'>, number> = { '8h': 8 * HOUR, '1w': 7 * 24 * HOUR };

/** When a timed mute ends, counted from now. */
export function muteEnds(duration: Exclude<MuteDuration, 'always'>, now = Date.now()): Date {
  return new Date(now + LENGTHS[duration]);
}

export type MuteState = { muted: string[]; mutedUntil: Record<string, Date> };

export function isMuted(state: MuteState, chatId: string, now = Date.now()): boolean {
  if (state.muted.includes(chatId)) return true;
  const until = state.mutedUntil[chatId];
  return until !== undefined && until.getTime() > now;
}

/** The next moment a timed mute runs out, so the list can redraw then. */
export function nextMuteExpiry(state: MuteState, now = Date.now()): number | null {
  const ends = Object.values(state.mutedUntil)
    .map((until) => until.getTime())
    .filter((time) => time > now);
  return ends.length ? Math.min(...ends) : null;
}

/** "Muted until 18:00", "Muted until Fri 18:00", "Muted", or null. */
export function muteLabel(state: MuteState, chatId: string, now = Date.now()): string | null {
  if (state.muted.includes(chatId)) return 'Muted always';
  const until = state.mutedUntil[chatId];
  if (!until || until.getTime() <= now) return null;
  const sameDay = new Date(now).toDateString() === until.toDateString();
  const time = until.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return sameDay
    ? `Muted until ${time}`
    : `Muted until ${until.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}, ${time}`;
}
