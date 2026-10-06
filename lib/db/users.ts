import {
  doc,
  getDoc,
  getDocFromCache,
  setDoc,
  updateDoc,
  runTransaction,
  serverTimestamp,
  arrayUnion,
  arrayRemove,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import type { UserDoc, AccountDoc, ContactDoc, RecoveryDoc } from './schema';
import type { KeyBackup } from '@/lib/crypto/types';
import { normalizePhone, tryNormalizePhone } from '@/lib/phone';

export async function getUser(uid: string): Promise<UserDoc | null> {
  const snapshot = await getDoc(doc(db(), 'users', uid));
  return snapshot.exists() ? (snapshot.data() as UserDoc) : null;
}

/**
 * This device's cached copy of a profile, without touching the network.
 * Undefined when there is none -- including a cached "does not exist", which
 * is worth confirming with the server before calling an account deleted.
 */
export async function getCachedUser(uid: string): Promise<UserDoc | undefined> {
  const snapshot = await getDocFromCache(doc(db(), 'users', uid)).catch(() => null);
  return snapshot?.exists() ? (snapshot.data() as UserDoc) : undefined;
}

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase().replace(/^@/, '');
}

export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

/**
 * The owner-only part of a profile: push tokens. users/{uid} is readable by
 * every signed-in user, so nothing private may live there.
 */
const accountRef = (uid: string) => doc(db(), 'users', uid, 'private', 'account');

/** The recovery-key backup. Owner-only, and kept off the public profile. */
const recoveryRef = (uid: string) => doc(db(), 'users', uid, 'private', 'recovery');

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
  recoveryBackup?: KeyBackup;
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
    if (params.recoveryBackup) {
      transaction.set(recoveryRef(params.uid), {
        backup: params.recoveryBackup,
        createdAt: serverTimestamp(),
      });
    }
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
  const phone = tryNormalizePhone(raw);
  if (!phone) return null;

  const claim = await getDoc(phoneRef(phone));
  if (!claim.exists()) return null;

  return getUser((claim.data() as { uid: string }).uid);
}

/**
 * Someone's phone number, or null if they have none or we may not see it yet
 * (the rules show it only once both of you have sent a message).
 */
export async function getPhone(uid: string): Promise<string | null> {
  try {
    const contact = await getDoc(contactRef(uid));
    return (contact.data() as ContactDoc | undefined)?.phone ?? null;
  } catch {
    // Permission denied: not ours to see.
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
    const current = (contact.data()?.phone as string | null | undefined) ?? null;
    if (current === next) return;

    // Claims are create-only, so one we already hold must not be rewritten.
    let alreadyMine = false;
    if (next) {
      const claim = await transaction.get(phoneRef(next));
      if (claim.exists() && claim.data().uid !== uid) throw new Error('PHONE_TAKEN');
      alreadyMine = claim.exists();
    }

    if (current) transaction.delete(phoneRef(current));
    transaction.set(contactRef(uid), { phone: next } satisfies ContactDoc);
    if (next && !alreadyMine) transaction.set(phoneRef(next), { uid });
  });
}

export async function registerPushToken(uid: string, token: string): Promise<void> {
  await setDoc(accountRef(uid), { pushTokens: arrayUnion(token) }, { merge: true });
}

export async function unregisterPushToken(uid: string, token: string): Promise<void> {
  await updateDoc(accountRef(uid), { pushTokens: arrayRemove(token) });
}

/** Re-wrapping after a passphrase change. The key itself never changes. */
export async function updateKeyBackup(uid: string, keyBackup: KeyBackup): Promise<void> {
  await updateDoc(doc(db(), 'users', uid), { keyBackup });
}

/** Null for accounts that have never made a recovery key. */
export async function getRecoveryBackup(uid: string): Promise<RecoveryDoc | null> {
  const snapshot = await getDoc(recoveryRef(uid));
  return snapshot.exists() ? (snapshot.data() as RecoveryDoc) : null;
}

/** Replaces any earlier recovery key: the old one stops working. */
export async function setRecoveryBackup(uid: string, backup: KeyBackup): Promise<void> {
  await setDoc(recoveryRef(uid), { backup, createdAt: serverTimestamp() });
}

export async function updateProfile(
  uid: string,
  patch: Partial<Pick<UserDoc, 'displayName' | 'about' | 'photoURL'>>,
): Promise<void> {
  await updateDoc(doc(db(), 'users', uid), patch);
}
