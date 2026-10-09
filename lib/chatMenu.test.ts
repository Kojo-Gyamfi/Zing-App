import { describe, expect, it } from 'vitest';
import { isMuted, muteEnds, muteLabel, nextMuteExpiry } from './mute';
import { toChatThemes } from './appearance';
import { isHidden, NOTHING_HIDDEN } from './hidden';

const NOW = new Date('2026-10-09T12:00:00').getTime();
const HOUR = 60 * 60 * 1000;

describe('muting a chat', () => {
  const state = {
    muted: ['always'],
    mutedUntil: { soon: new Date(NOW + HOUR), past: new Date(NOW - HOUR), week: muteEnds('1w', NOW) },
  };

  it('is muted for good, until a time, or not at all', () => {
    expect(isMuted(state, 'always', NOW)).toBe(true);
    expect(isMuted(state, 'soon', NOW)).toBe(true);
    expect(isMuted(state, 'past', NOW)).toBe(false);
    expect(isMuted(state, 'other', NOW)).toBe(false);
    // ...and a timed mute runs out by itself.
    expect(isMuted(state, 'soon', NOW + 2 * HOUR)).toBe(false);
  });

  it('lasts 8 hours or a week', () => {
    expect(muteEnds('8h', NOW).getTime() - NOW).toBe(8 * HOUR);
    expect(muteEnds('1w', NOW).getTime() - NOW).toBe(7 * 24 * HOUR);
  });

  it('knows when the next timed mute ends, ignoring ones already over', () => {
    expect(nextMuteExpiry(state, NOW)).toBe(NOW + HOUR);
    expect(nextMuteExpiry({ muted: [], mutedUntil: {} }, NOW)).toBeNull();
  });

  it('describes the state for the menus', () => {
    expect(muteLabel(state, 'always', NOW)).toBe('Muted always');
    expect(muteLabel(state, 'soon', NOW)).toMatch(/^Muted until /);
    expect(muteLabel(state, 'past', NOW)).toBeNull();
  });
});

describe('per-chat themes', () => {
  it('keeps known wallpapers and bubble colours only', () => {
    expect(
      toChatThemes({
        a: { wallpaper: 'forest', bubble: 'rose' },
        b: { wallpaper: 'neon' },
        c: { bubble: 'blue', extra: 1 },
        d: 'junk',
      }),
    ).toEqual({ a: { wallpaper: 'forest', bubble: 'rose' }, c: { bubble: 'blue' } });
    expect(toChatThemes(undefined)).toEqual({});
  });
});

describe('clear chat', () => {
  const clearedAt = new Date(NOW);
  const hidden = { ids: new Set(['x']), clearedAt };

  it('hides everything sent up to the clear, and single hides as before', () => {
    expect(isHidden({ id: 'a', createdAt: new Date(NOW - 1) }, hidden)).toBe(true);
    expect(isHidden({ id: 'b', createdAt: new Date(NOW) }, hidden)).toBe(true);
    expect(isHidden({ id: 'c', createdAt: new Date(NOW + 1) }, hidden)).toBe(false);
    expect(isHidden({ id: 'x', createdAt: new Date(NOW + 1) }, hidden)).toBe(true);
  });

  it('keeps a message still on its way, which has no server time yet', () => {
    expect(isHidden({ id: 'p', createdAt: null }, hidden)).toBe(false);
  });

  it('hides nothing in a chat never cleared', () => {
    expect(isHidden({ id: 'a', createdAt: new Date(0) }, NOTHING_HIDDEN)).toBe(false);
  });
});
