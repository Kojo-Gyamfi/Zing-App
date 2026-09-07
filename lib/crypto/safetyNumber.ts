import { getSodium } from './sodium';

/**
 * A 60-digit fingerprint of two identities, for verifying out of band that
 * nobody swapped a public key in transit.
 *
 * Zing hands out public keys through Firestore, which means a compromised
 * server could in principle substitute its own. Comparing this number in
 * person (or over a call) is what closes that hole -- without it the E2EE
 * claim rests on trusting the very server we said we don't trust.
 *
 * Sorting the inputs makes the result identical on both sides.
 */
export async function safetyNumber(a: Uint8Array, b: Uint8Array): Promise<string> {
  const sodium = await getSodium();

  const [first, second] = [a, b]
    .map((key) => sodium.to_hex(key))
    .sort();

  // 36 bytes -> 12 groups of 3 bytes -> 12 groups of 5 digits.
  const digest = sodium.crypto_generichash(36, sodium.from_string(first + second), null);

  const groups: string[] = [];
  for (let i = 0; i < digest.length; i += 3) {
    const chunk = (digest[i] << 16) | (digest[i + 1] << 8) | digest[i + 2];
    groups.push(String(chunk % 100000).padStart(5, '0'));
  }

  return groups.join(' ');
}

/**
 * Short fingerprint of a single identity, stored locally per peer so we can
 * shout if their key ever changes.
 */
export async function keyFingerprint(publicKey: Uint8Array): Promise<string> {
  const sodium = await getSodium();
  return sodium.to_hex(sodium.crypto_generichash(16, publicKey, null));
}
