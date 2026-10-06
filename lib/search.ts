import type { DecryptedMessage } from '@/lib/db/schema';

/**
 * Search inside a chat. Runs over the plaintext this device has already
 * decrypted -- the server holds ciphertext only and can never search, which is
 * the point. Case- and accent-insensitive, the way people actually type.
 */
export function normalizeForSearch(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

/** Ids of the messages that contain the query, oldest first. */
export function findMatches(messages: DecryptedMessage[], query: string): string[] {
  const needle = normalizeForSearch(query.trim());
  if (!needle) return [];
  return messages
    .filter((message) => !message.deleted && message.text !== null)
    .filter((message) => normalizeForSearch(message.text!).includes(needle))
    .map((message) => message.id);
}

/**
 * Splits text into runs, marking the ones that match, for highlighting. Runs
 * index into the original text, so accents and case show as typed. Assumes
 * normalising does not change a string's length, which holds for the
 * accented letters people write; when it does not, nothing is highlighted
 * rather than the wrong letters.
 */
export function splitMatches(text: string, query: string): { text: string; match: boolean }[] {
  const needle = normalizeForSearch(query.trim());
  const haystack = normalizeForSearch(text);
  if (!needle || haystack.length !== text.length) return [{ text, match: false }];

  const runs: { text: string; match: boolean }[] = [];
  let from = 0;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, from)) {
    if (at > from) runs.push({ text: text.slice(from, at), match: false });
    runs.push({ text: text.slice(at, at + needle.length), match: true });
    from = at + needle.length;
  }
  if (from < text.length) runs.push({ text: text.slice(from), match: false });
  return runs;
}
