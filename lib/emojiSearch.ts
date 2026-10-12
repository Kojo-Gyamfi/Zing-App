import { normalizeForSearch } from './search';

/** [emoji, name, words it can be found by], as generated into components/chat/emojiKeywords.ts. */
export type EmojiEntry = readonly [emoji: string, name: string, words: string];

const MAX_RESULTS = 120;

/** Lower case, no accents, and ":joy:" or "thumbs-up" read as plain words. */
function words(text: string): string[] {
  return normalizeForSearch(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/**
 * Emoji matching a search, as on WhatsApp: every word typed must start one of
 * the emoji's words ("hea" finds ❤️, "thumbs up" finds 👍, "lol" finds 😂).
 * The closest names come first, then the picker's own order. Runs on the
 * device over the bundled list; nothing is looked up anywhere.
 */
export function searchEmoji(entries: readonly EmojiEntry[], query: string): string[] {
  const wanted = words(query);
  if (wanted.length === 0) return [];
  const phrase = wanted.join(' ');

  const scored: { emoji: string; score: number; order: number }[] = [];
  entries.forEach(([emoji, name, keywords], order) => {
    const own = words(keywords);
    if (!wanted.every((word) => own.some((candidate) => candidate.startsWith(word)))) return;
    const title = words(name).join(' ');
    const nameWords = title.split(' ');
    const score =
      title === phrase
        ? 0
        : title.startsWith(phrase)
          ? 1
          : wanted.every((word) => nameWords.some((candidate) => candidate.startsWith(word)))
            ? 2
            : 3;
    scored.push({ emoji, score, order });
  });
  scored.sort((a, b) => a.score - b.score || a.order - b.order);
  return scored.slice(0, MAX_RESULTS).map((entry) => entry.emoji);
}
