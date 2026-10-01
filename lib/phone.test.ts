import { describe, it, expect } from 'vitest';
import { normalizePhone, tryNormalizePhone, limitPhoneInput, formatPhone, E164_PATTERN } from './phone';

describe('phone normalization', () => {
  it('gives every spelling of one number the same canonical form', () => {
    const spellings = ['0241234567', '024 123 4567', '024-123-4567', '+233241234567', '+233 24 123 4567', ' 0241234567 '];
    for (const spelling of spellings) expect(normalizePhone(spelling)).toBe('+233241234567');
  });

  it('produces E.164 that the rules accept', () => {
    expect(normalizePhone('0201234567')).toMatch(E164_PATTERN);
    expect(normalizePhone('+1 212 555 1234')).toMatch(E164_PATTERN);
  });

  it('treats an empty field as no number', () => {
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone('   ')).toBeNull();
  });

  it('rejects more than 10 local digits', () => {
    expect(() => normalizePhone('02412345678')).toThrow('PHONE_INVALID');
  });

  it('rejects numbers that cannot exist', () => {
    expect(() => normalizePhone('024123456')).toThrow('PHONE_INVALID');
    expect(() => normalizePhone('12345')).toThrow('PHONE_INVALID');
    expect(() => normalizePhone('call me')).toThrow('PHONE_INVALID');
  });

  it('returns null instead of throwing for lookups', () => {
    expect(tryNormalizePhone('nonsense')).toBeNull();
    expect(tryNormalizePhone('0241234567')).toBe('+233241234567');
  });
});

describe('phone input limit', () => {
  it('stops at 10 digits for a local number', () => {
    expect(limitPhoneInput('024123456789')).toBe('0241234567');
    expect(limitPhoneInput('024 123 4567 89')).toBe('024 123 4567 ');
  });

  it('allows a country code on top', () => {
    expect(limitPhoneInput('+233 24 123 4567')).toBe('+233 24 123 4567');
  });

  it('drops anything that is not part of a number', () => {
    expect(limitPhoneInput('024abc123(4567)')).toBe('0241234567');
  });
});

describe('phone display', () => {
  it('shows Ghanaian numbers in local style and others internationally', () => {
    expect(formatPhone('+233241234567')).toBe('024 123 4567');
    expect(formatPhone('+12125551234')).toBe('+1 212 555 1234');
  });
});
