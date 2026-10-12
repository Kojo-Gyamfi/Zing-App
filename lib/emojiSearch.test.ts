import { describe, expect, it } from 'vitest';
import { searchEmoji } from './emojiSearch';
import { EMOJI_KEYWORDS } from '../components/chat/emojiKeywords';
import { EMOJI_CATEGORIES } from '../components/chat/emojiData';

describe('emoji search', () => {
  it('finds by name, tag and shortcode, closest name first', () => {
    expect(searchEmoji(EMOJI_KEYWORDS, 'fire')[0]).toBe('🔥');
    expect(searchEmoji(EMOJI_KEYWORDS, 'lol')).toContain('😂');
    expect(searchEmoji(EMOJI_KEYWORDS, 'thumbs up')[0]).toBe('👍');
    expect(searchEmoji(EMOJI_KEYWORDS, ':joy:')).toContain('😂');
    expect(searchEmoji(EMOJI_KEYWORDS, 'ghana')).toEqual(['🇬🇭']);
  });

  it('matches word beginnings, in any order, ignoring case and accents', () => {
    expect(searchEmoji(EMOJI_KEYWORDS, 'HEA')).toContain('❤️');
    expect(searchEmoji(EMOJI_KEYWORDS, 'joy tears')).toContain('😂');
    expect(searchEmoji(EMOJI_KEYWORDS, 'piñata')).toEqual(searchEmoji(EMOJI_KEYWORDS, 'pinata'));
    // Inside a word is not a match: "art" should not find every heart.
    expect(searchEmoji(EMOJI_KEYWORDS, 'art')).not.toContain('❤️');
  });

  it('finds nothing for nothing, or for nonsense', () => {
    expect(searchEmoji(EMOJI_KEYWORDS, '   ')).toEqual([]);
    expect(searchEmoji(EMOJI_KEYWORDS, 'zzqqx')).toEqual([]);
  });

  it('has words for every emoji the picker shows', () => {
    const shown = new Set(EMOJI_CATEGORIES.flatMap((category) => category.emoji));
    const named = new Set(EMOJI_KEYWORDS.map(([emoji]) => emoji));
    expect([...shown].filter((emoji) => !named.has(emoji))).toEqual([]);
  });
});
