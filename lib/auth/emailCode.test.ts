import { describe, expect, it } from 'vitest';
import {
  codeMatches,
  generateCode,
  hashCode,
  isCodeShaped,
  keyFor,
  looksLikeEmail,
  normalizeEmail,
} from './emailCode';

describe('email sign-in codes', () => {
  it('generates six digits, leading zeros included', () => {
    for (let i = 0; i < 200; i++) expect(isCodeShaped(generateCode())).toBe(true);
    expect(isCodeShaped('012345')).toBe(true);
    expect(isCodeShaped('12345')).toBe(false);
    expect(isCodeShaped('12345a')).toBe(false);
  });

  it('matches only the right code for the right address', () => {
    const stored = hashCode('secret', 'kojo@icloud.com', '123456');
    expect(codeMatches('secret', 'kojo@icloud.com', '123456', stored)).toBe(true);
    expect(codeMatches('secret', 'kojo@icloud.com', '123457', stored)).toBe(false);
    expect(codeMatches('secret', 'ama@gmail.com', '123456', stored)).toBe(false);
    expect(codeMatches('other', 'kojo@icloud.com', '123456', stored)).toBe(false);
  });

  it('never stores the code or the address in the clear', () => {
    expect(hashCode('secret', 'kojo@icloud.com', '123456')).not.toContain('123456');
    expect(keyFor('kojo@icloud.com')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('accepts any provider and treats case and spaces as the same address', () => {
    expect(looksLikeEmail('kojo@icloud.com')).toBe(true);
    expect(looksLikeEmail(' kojo@outlook.com ')).toBe(true);
    expect(looksLikeEmail('kojo@icloud')).toBe(false);
    expect(looksLikeEmail('kojo icloud.com')).toBe(false);
    expect(normalizeEmail('  Kojo@iCloud.com ')).toBe('kojo@icloud.com');
  });
});
