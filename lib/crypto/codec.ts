import { getSodium } from './sodium';

/** Standard base64 with padding -- what we store in Firestore. */
export async function toB64(bytes: Uint8Array): Promise<string> {
  const sodium = await getSodium();
  return sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL);
}

export async function fromB64(text: string): Promise<Uint8Array> {
  const sodium = await getSodium();
  return sodium.from_base64(text, sodium.base64_variants.ORIGINAL);
}
