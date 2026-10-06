/** The quick row at the top of the message menu, as on WhatsApp. */
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

export type ReactionChip = { emoji: string; count: number; mine: boolean };

/**
 * The chips under a bubble: one per distinct emoji, most popular first, ties
 * in a stable order so they do not shuffle as reactions arrive.
 */
export function summarizeReactions(
  reactions: Record<string, string> | undefined,
  me: string | undefined,
): ReactionChip[] {
  const chips = new Map<string, ReactionChip>();
  for (const [uid, emoji] of Object.entries(reactions ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    const chip = chips.get(emoji) ?? { emoji, count: 0, mine: false };
    chip.count += 1;
    chip.mine ||= uid === me;
    chips.set(emoji, chip);
  }
  return [...chips.values()].sort((a, b) => b.count - a.count);
}

/** A reactions map with one member's reaction set or (emoji null) removed. */
export function withReaction(
  reactions: Record<string, string> | undefined,
  uid: string,
  emoji: string | null,
): Record<string, string> {
  const next = { ...reactions };
  if (emoji === null) delete next[uid];
  else next[uid] = emoji;
  return next;
}
