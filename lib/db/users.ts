import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  runTransaction,
  serverTimestamp,
  arrayUnion,
  deleteField,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import type { UserDoc, AccountDoc, ContactDoc } from './schema';
import type { KeyBackup } from '@/lib/crypto/types';

export async function getUser(uid: string): Promise<UserDoc | null> {
  const snapshot = await getDoc(doc(db(), 'users', uid));
  return snapshot.exists() ? (snapshot.data() as UserDoc) : null;
}

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase().replace(/^@/, '');
}

export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

export function normalizePhone(raw: string): string | null {
  const phone = raw.replace(/[\s-]/g, '');
  return phone || null;
}

/**
 * The owner-only part of a profile: push tokens. users/{uid} is readable by
 * every signed-in user, so nothing private may live there.
 */
const accountRef = (uid: string) => doc(db(), 'users', uid, 'private', 'account');

/**
 * The phone number. Readable by its owner and by anyone who already has a chat
 * with them -- not by every signed-in user, which is what users/{uid} allows.
 */
const contactRef = (uid: string) => doc(db(), 'users', uid, 'shared', 'contact');

/**
 * Phone lookup doc. Rules allow get but never list, so a number can be checked
 * by someone who already knows it but the collection cannot be dumped.
 */
const phoneRef = (phone: string) => doc(db(), 'phones', phone);

/**
 * Claim a handle and write the profile in one transaction.
 *
 * The usernames/ collection exists purely so uniqueness can be enforced by a
 * rule (create-only, never updated) rather than by hoping two people don't
 * pick "kwame" at the same moment. The rules also require the claim and the
 * profile to land together, so a profile cannot name a handle it never claimed.
 */
export async function createProfile(params: {
  uid: string;
  username: string;
  displayName: string;
  photoURL: string | null;
  publicKey: string;
  keyBackup: KeyBackup;
  phone: string | null;
}): Promise<void> {
  const username = normalizeUsername(params.username);
  const phone = params.phone ? normalizePhone(params.phone) : null;

  await runTransaction(db(), async (transaction) => {
    const claimRef = doc(db(), 'usernames', username);
    if ((await transaction.get(claimRef)).exists()) {
      throw new Error('USERNAME_TAKEN');
    }
    if (phone && (await transaction.get(phoneRef(phone))).exists()) {
      throw new Error('PHONE_TAKEN');
    }

    transaction.set(claimRef, { uid: params.uid });
    transaction.set(doc(db(), 'users', params.uid), {
      uid: params.uid,
      username,
      displayName: params.displayName,
      photoURL: params.photoURL,
      about: 'On Zing',
      publicKey: params.publicKey,
      keyBackup: params.keyBackup,
      createdAt: serverTimestamp(),
    });
    transaction.set(accountRef(params.uid), { pushTokens: [] } satisfies AccountDoc);
    transaction.set(contactRef(params.uid), { phone } satisfies ContactDoc);
    if (phone) transaction.set(phoneRef(phone), { uid: params.uid });
  });
}

export async function findByUsername(raw: string): Promise<UserDoc | null> {
  const username = normalizeUsername(raw);
  const claim = await getDoc(doc(db(), 'usernames', username));
  if (!claim.exists()) return null;

  return getUser((claim.data() as { uid: string }).uid);
}

/** Optional discovery path -- only finds people who chose to publish a number. */
export async function findByPhone(raw: string): Promise<UserDoc | null> {
  const phone = normalizePhone(raw);
  if (!phone) return null;

  const claim = await getDoc(phoneRef(phone));
  if (!claim.exists()) return null;

  return getUser((claim.data() as { uid: string }).uid);
}

/**
 * Someone's phone number, or null if they have none or we may not see it.
 *
 * `own` also checks the old location: for a short while the number lived in
 * the owner-only account doc, and setPhone moves it across on the next save.
 */
export async function getPhone(uid: string, own = false): Promise<string | null> {
  try {
    const contact = await getDoc(contactRef(uid));
    const phone = (contact.data() as ContactDoc | undefined)?.phone ?? null;
    if (phone || !own) return phone;

    const account = await getDoc(accountRef(uid));
    return (account.data()?.phone as string | undefined) ?? null;
  } catch {
    // Permission denied: no chat with this person, so their number is not ours to see.
    return null;
  }
}

/**
 * Move this user's phone claim. Releasing the old number and taking the new one
 * happen together, so a failed save never leaves someone findable by neither.
 */
export async function setPhone(uid: string, raw: string): Promise<void> {
  const next = normalizePhone(raw);

  await runTransaction(db(), async (transaction) => {
    const contact = await transaction.get(contactRef(uid));
    const account = await transaction.get(accountRef(uid));
    const legacy = (account.data()?.phone as string | null | undefined) ?? null;
    const current = (contact.data()?.phone as string | null | undefined) ?? legacy;
    if (current === next && !legacy) return;

    // Claims are create-only, so one we already hold must not be rewritten.
    let alreadyMine = false;
    if (next) {
      const claim = await transaction.get(phoneRef(next));
      if (claim.exists() && claim.data().uid !== uid) throw new Error('PHONE_TAKEN');
      alreadyMine = claim.exists();
    }

    if (current && current !== next) transaction.delete(phoneRef(current));
    transaction.set(contactRef(uid), { phone: next } satisfies ContactDoc);
    if (legacy) transaction.set(accountRef(uid), { phone: deleteField() }, { merge: true });
    if (next && !alreadyMine) transaction.set(phoneRef(next), { uid });
  });
}

export async function registerPushToken(uid: string, token: string): Promise<void> {
  await setDoc(accountRef(uid), { pushTokens: arrayUnion(token) }, { merge: true });
}

/** Re-wrapping after a passphrase change. The key itself never changes. */
export async function updateKeyBackup(uid: string, keyBackup: KeyBackup): Promise<void> {
  await updateDoc(doc(db(), 'users', uid), { keyBackup });
}

export async function updateProfile(
  uid: string,
  patch: Partial<Pick<UserDoc, 'displayName' | 'about' | 'photoURL'>>,
): Promise<void> {
  await updateDoc(doc(db(), 'users', uid), patch);
}
