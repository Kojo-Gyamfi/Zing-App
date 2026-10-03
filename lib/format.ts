/**
 * 12-hour clock, "3:05 PM". en-US is pinned so the format is the same on every
 * phone, whatever its regional settings would pick.
 */
const CLOCK = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

export function clockTime(date: Date): string {
  return CLOCK.format(date);
}

/** Chat-list timestamp: time today, "Yesterday", weekday this week, else a date. */
export function listTime(date: Date | null): string {
  if (!date) return '';

  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) {
    return clockTime(date);
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';

  const daysAgo = (now.getTime() - date.getTime()) / 86_400_000;
  if (daysAgo < 7) return date.toLocaleDateString([], { weekday: 'short' });

  return date.toLocaleDateString([], { day: '2-digit', month: '2-digit', year: '2-digit' });
}

/** Bubble timestamp. */
export function bubbleTime(date: Date | null): string {
  if (!date) return '';
  return clockTime(date);
}

/** Day divider inside a thread. */
export function dayLabel(date: Date): string {
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return 'Today';

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';

  return date.toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' });
}

export function lastSeenLabel(presence: { online: boolean; lastSeen: number | null }): string {
  if (presence.online) return 'online';
  if (!presence.lastSeen) return '';

  const date = new Date(presence.lastSeen);
  const minutes = Math.floor((Date.now() - presence.lastSeen) / 60_000);

  if (minutes < 1) return 'last seen just now';
  if (minutes < 60) return `last seen ${minutes}m ago`;
  if (date.toDateString() === new Date().toDateString()) {
    return `last seen today at ${bubbleTime(date)}`;
  }
  return `last seen ${listTime(date)}`;
}
