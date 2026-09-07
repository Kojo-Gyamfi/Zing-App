import { getSodium } from './sodium';
import { toB64, fromB64 } from './codec';
import type { KeyBackup } from './types';

/**
 * Argon2id parameters.
 *
 * libsodium's MODERATE preset asks for 256 MiB, which mobile Safari will not
 * reliably hand to a WASM heap. We keep the INTERACTIVE memory ceiling (64 MiB)
 * but raise the time cost, which buys back strength without the OOM risk.
 *
 * These values are stored alongside every backup, so raising them later
 * applies to new backups without invalidating old ones.
 */
const OPSLIMIT = 3;
const MEMLIMIT = 64 * 1024 * 1024;

/**
 * Wrap the private key for server-side storage.
 *
 * This is the one thing standing between a Firestore dump and every message
 * the user has ever sent, so the passphrase strength is the whole game --
 * the onboarding UI has to be blunt about that.
 */
export async function wrapPrivateKey(privateKey: Uint8Array, passphrase: string): Promise<KeyBackup> {
  const sodium = await getSodium();

  const salt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
  const wrappingKey = sodium.crypto_pwhash(
    sodium.crypto_secretbox_KEYBYTES,
    passphrase,
    salt,
    OPSLIMIT,
    MEMLIMIT,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );

  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ciphertext = sodium.crypto_secretbox_easy(privateKey, nonce, wrappingKey);

  return {
    ciphertext: await toB64(ciphertext),
    nonce: await toB64(nonce),
    salt: await toB64(salt),
    opslimit: OPSLIMIT,
    memlimit: MEMLIMIT,
  };
}

/**
 * Unwrap on a new device. Returns null on a wrong passphrase -- callers show
 * "that passphrase didn't work", never a stack trace.
 */
export async function unwrapPrivateKey(backup: KeyBackup, passphrase: string): Promise<Uint8Array | null> {
  const sodium = await getSodium();

  try {
    const wrappingKey = sodium.crypto_pwhash(
      sodium.crypto_secretbox_KEYBYTES,
      passphrase,
      await fromB64(backup.salt),
      backup.opslimit,
      backup.memlimit,
      sodium.crypto_pwhash_ALG_ARGON2ID13,
    );

    return sodium.crypto_secretbox_open_easy(
      await fromB64(backup.ciphertext),
      await fromB64(backup.nonce),
      wrappingKey,
    );
  } catch {
    return null;
  }
}
