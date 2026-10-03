import { describe, expect, it } from 'vitest';
import { bubbleTime, clockTime } from './format';

describe('time format', () => {
  it('uses a 12-hour clock with AM/PM', () => {
    expect(clockTime(new Date(2026, 9, 3, 0, 5))).toBe('12:05 AM');
    expect(clockTime(new Date(2026, 9, 3, 9, 30))).toBe('9:30 AM');
    expect(clockTime(new Date(2026, 9, 3, 12, 0))).toBe('12:00 PM');
    expect(clockTime(new Date(2026, 9, 3, 15, 5))).toBe('3:05 PM');
    expect(clockTime(new Date(2026, 9, 3, 23, 59))).toBe('11:59 PM');
  });

  it('shows nothing for a message not yet stamped by the server', () => {
    expect(bubbleTime(null)).toBe('');
  });
});
