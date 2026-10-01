import { getSodium } from './sodium';
import { wrapPrivateKey, unwrapPrivateKey } from './backup';
import type { KeyBackup } from './types';

/**
 * The recovery key: a second, random way to unwrap the private key when the
 * passphrase is forgotten. Like WhatsApp's 64-digit backup key, it only works
 * because the USER holds it -- Zing stores nothing that could rebuild it.
 *
 * 120 random bits, written as 24 characters of Crockford base32. Crockford
 * drops I, L, O and U so a key copied onto paper can't be misread, and the
 * normalizer forgives the lookalikes anyway.
 *
 * Wrapping reuses the passphrase backup format unchanged. Argon2id is far more
 * than 120 random bits need, but it means one code path and no new crypto.
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const BYTES = 15; // 120 bits -> 24 base32 characters
export const RECOVERY_KEY_LENGTH = 24;

function encode(bytes: Uint8Array): string {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(buffer >> bits) & 31];
    }
    buffer &= (1 << bits) - 1;
  }
  return out;
}

/** Groups of four, for display: XXXX-XXXX-XXXX-XXXX-XXXX-XXXX. */
export function formatRecoveryKey(normalized: string): string {
  return normalized.match(/.{1,4}/g)?.join('-') ?? normalized;
}

export async function generateRecoveryKey(): Promise<string> {
  const sodium = await getSodium();
  return formatRecoveryKey(encode(sodium.randombytes_buf(BYTES)));
}

/**
 * Canonical form of a typed-in key: uppercase, no spaces or dashes, and the
 * characters Crockford excludes mapped to the ones they get mistaken for.
 */
export function normalizeRecoveryKey(input: string): string {
  return input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

/** True when the input could be a recovery key -- checked before running Argon2. */
export function isWellFormedRecoveryKey(input: string): boolean {
  const normalized = normalizeRecoveryKey(input);
  return normalized.length === RECOVERY_KEY_LENGTH && [...normalized].every((c) => ALPHABET.includes(c));
}

export function wrapWithRecoveryKey(privateKey: Uint8Array, recoveryKey: string): Promise<KeyBackup> {
  return wrapPrivateKey(privateKey, normalizeRecoveryKey(recoveryKey));
}

/** Null on a wrong key, like unwrapPrivateKey. */
export function unwrapWithRecoveryKey(backup: KeyBackup, recoveryKey: string): Promise<Uint8Array | null> {
  return unwrapPrivateKey(backup, normalizeRecoveryKey(recoveryKey));
}
