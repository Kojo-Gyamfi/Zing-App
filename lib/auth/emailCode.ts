import { createHash, createHmac, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * Email sign-in codes, the server half: Zing emails a 6-digit code from its
 * own Gmail account and checks it here, then hands the browser a Firebase
 * custom token. Firebase keeps the session (the security rules need
 * request.auth); the proof of owning the address is ours.
 *
 * Only an HMAC of a code is ever stored, keyed with a server secret, so a
 * leaked database row cannot be turned back into a working code.
 */

export const CODE_LENGTH = 6;
export const CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_ATTEMPTS = 5;

/** Loose on purpose: the code sent to the address is the real check. */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** Uniform over 000000-999999, leading zeros kept. */
export function generateCode(): string {
  return randomInt(0, 10 ** CODE_LENGTH).toString().padStart(CODE_LENGTH, '0');
}

export function isCodeShaped(value: string): boolean {
  return value.length === CODE_LENGTH && /^\d+$/.test(value);
}

/** Document id for per-address and per-IP state: never the raw value. */
export function keyFor(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Bound to the address, so a code for one email never works for another. */
export function hashCode(secret: string, email: string, code: string): string {
  return createHmac('sha256', secret).update(`${email}\n${code}`).digest('hex');
}

export function codeMatches(secret: string, email: string, code: string, stored: string): boolean {
  const actual = Buffer.from(hashCode(secret, email, code), 'hex');
  const expected = Buffer.from(stored, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function codeSecret(): string {
  const secret = process.env.EMAIL_CODE_SECRET;
  if (!secret) throw new Error('EMAIL_CODE_SECRET is not set');
  return secret;
}
