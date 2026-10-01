import { getSodium } from './sodium';
import { toB64 } from './codec';
import type { Identity } from './types';

/**
 * A user's long-term X25519 identity pair, generated once on first sign-in.
 * The public half goes to Firestore; the private half never leaves the device
 * except as a passphrase-wrapped backup (see backup.ts).
 */
export async function generateIdentity(): Promise<Identity> {
  const sodium = await getSodium();
  const pair = sodium.crypto_box_keypair();
  return { publicKey: pair.publicKey, privateKey: pair.privateKey };
}

/** Recover the public half from a stored private key, so backups need only carry one. */
export async function publicKeyFrom(privateKey: Uint8Array): Promise<Uint8Array> {
  const sodium = await getSodium();
  return sodium.crypto_scalarmult_base(privateKey);
}

/**
 * True when a private key belongs to the registered public key. Checked after
 * every unwrap so a key that would fail every decryption is refused up front.
 */
export async function matchesPublicKey(privateKey: Uint8Array, publicKeyB64: string): Promise<boolean> {
  return (await toB64(await publicKeyFrom(privateKey))) === publicKeyB64;
}
