import { describe, expect, it } from 'vitest';
import { findMatches, splitMatches } from './search';
import { summarizeReactions, withReaction } from './reactions';
import type { DecryptedMessage } from './db/schema';

const message = (id: string, text: string | null, extra: Partial<DecryptedMessage> = {}) =>
  ({
    id,
    senderId: 'a',
    text,
    createdAt: null,
    replyTo: null,
    edited: false,
    deleted: false,
    pending: false,
    ...extra,
  }) satisfies DecryptedMessage;

describe('search inside a chat', () => {
  const thread = [
    message('1', 'See you at the Café'),
    message('2', 'cafe is closed'),
    message('3', null),
    message('4', 'gone', { deleted: true, text: null }),
    message('5', 'nothing here'),
  ];

  it('matches ignoring case and accents, oldest first', () => {
    expect(findMatches(thread, 'CAFE')).toEqual(['1', '2']);
    expect(findMatches(thread, 'café')).toEqual(['1', '2']);
  });

  it('skips undecryptable and deleted messages, and blank queries', () => {
    expect(findMatches(thread, 'gone')).toEqual([]);
    expect(findMatches(thread, '   ')).toEqual([]);
  });

  it('highlights every match in the original spelling', () => {
    expect(splitMatches('Café and cafe', 'cafe')).toEqual([
      { text: 'Café', match: true },
      { text: ' and ', match: false },
      { text: 'cafe', match: true },
    ]);
    expect(splitMatches('no hit', 'xyz')).toEqual([{ text: 'no hit', match: false }]);
  });
});

describe('reactions', () => {
  it('groups by emoji, most popular first, and marks mine', () => {
    expect(summarizeReactions({ a: '👍', b: '❤️', c: '👍' }, 'b')).toEqual([
      { emoji: '👍', count: 2, mine: false },
      { emoji: '❤️', count: 1, mine: true },
    ]);
    expect(summarizeReactions(undefined, 'a')).toEqual([]);
  });

  it('sets, replaces and removes one member at a time', () => {
    expect(withReaction({ a: '👍' }, 'b', '😂')).toEqual({ a: '👍', b: '😂' });
    expect(withReaction({ a: '👍' }, 'a', '❤️')).toEqual({ a: '❤️' });
    expect(withReaction({ a: '👍', b: '😂' }, 'a', null)).toEqual({ b: '😂' });
  });
});
