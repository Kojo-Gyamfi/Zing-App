import { getSodium } from './sodium';
import { toB64, fromB64 } from './codec';
import type { Identity } from './types';

/**
 * One symmetric key per conversation, sealed to each member's public key.
 *
 * Sealed boxes (crypto_box_seal) are anonymous: the sender needs only the
 * recipient's public key, and nothing about the sender is recorded in the
 * output. That is what makes adding a group member later a one-line change --
 * seal the same conversation key to one more public key.
 *
 * Note the deliberate limit: this design has no forward secrecy. Whoever holds
 * the conversation key can read that conversation's whole history. Getting
 * beyond that means the Double Ratchet, which is out of scope for v1.
 */

export async function createConversationKey(): Promise<Uint8Array> {
  const sodium = await getSodium();
  return sodium.crypto_secretbox_keygen();
}

/** Seal the conversation key to one member. Result is safe to store in Firestore. */
export async function sealConversationKey(
  conversationKey: Uint8Array,
  memberPublicKey: Uint8Array,
): Promise<string> {
  const sodium = await getSodium();
  return toB64(sodium.crypto_box_seal(conversationKey, memberPublicKey));
}

/** Open the copy addressed to us. Null means it was not sealed to this identity. */
export async function openConversationKey(
  sealed: string,
  identity: Identity,
): Promise<Uint8Array | null> {
  const sodium = await getSodium();
  try {
    return sodium.crypto_box_seal_open(
      await fromB64(sealed),
      identity.publicKey,
      identity.privateKey,
    );
  } catch {
    return null;
  }
}
