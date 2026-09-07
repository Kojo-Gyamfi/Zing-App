import { getSodium } from './sodium';
import { toB64, fromB64 } from './codec';
import type { Envelope } from './types';

/**
 * The single choke point for message content.
 *
 * Nothing else in the app may write a message body to Firestore. If plaintext
 * ever reaches the database it will be because something bypassed this file.
 */

export async function seal(plaintext: string, key: Uint8Array): Promise<Envelope> {
  const sodium = await getSodium();
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ciphertext = sodium.crypto_secretbox_easy(sodium.from_string(plaintext), nonce, key);
  return {
    ciphertext: await toB64(ciphertext),
    nonce: await toB64(nonce),
  };
}

/**
 * Returns null rather than throwing when a message cannot be decrypted --
 * a device that joined after the fact, or a corrupted row, should render a
 * placeholder bubble instead of tearing down the whole thread.
 */
export async function open(envelope: Envelope, key: Uint8Array): Promise<string | null> {
  const sodium = await getSodium();
  try {
    const plaintext = sodium.crypto_secretbox_open_easy(
      await fromB64(envelope.ciphertext),
      await fromB64(envelope.nonce),
      key,
    );
    return sodium.to_string(plaintext);
  } catch {
    return null;
  }
}
