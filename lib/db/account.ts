'use client';

import {
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  writeBatch,
} from 'firebase/firestore';
import { reauthenticateWithPopup, type User } from 'firebase/auth';
import { db, googleProvider } from '@/lib/firebase/client';
import { forgetPresence } from '@/lib/db/presence';
import { disablePush } from '@/lib/push';
import type { ContactDoc } from './schema';

/** Firestore's cap on writes in one batch. */
const BATCH_LIMIT = 500;

/**
 * Firebase wants a sign-in within the last five minutes before it deletes an
 * account. A minute of margin covers the time the deletion itself takes.
 */
const RECENT_SIGN_IN_MS = 4 * 60 * 1000;

/** Thrown when an email-link account must open a fresh link first. */
export const NEEDS_FRESH_LINK = 'zing/needs-fresh-link';

/**
 * Google accounts confirm in a popup. Email-link accounts have no popup to
 * offer: if their sign-in is not recent, the caller emails them a new link
 * and they come back to try again.
 */
async function confirmIdentity(user: User): Promise<void> {
  if (user.providerData.some((entry) => entry.providerId === 'google.com')) {
    await reauthenticateWithPopup(user, googleProvider);
    return;
  }
  const { authTime } = await user.getIdTokenResult();
  if (Date.now() - new Date(authTime).getTime() > RECENT_SIGN_IN_MS) {
    throw Object.assign(new Error('Sign in again to delete the account.'), {
      code: NEEDS_FRESH_LINK,
    });
  }
}

/**
 * "Delete my account", done from the client through the security rules (a
 * Cloud Function would be tidier but needs the paid plan).
 *
 * Removed: the profile and with it the public key and passphrase backup, the
 * @username and phone claims (both free for someone else to take), push
 * tokens, the recovery backup, the phone number, every "Delete for me" list,
 * presence, and the sign-in account itself.
 *
 * Kept: chats and messages. They belong to the other person as well, and they
 * are ciphertext that nobody can open once the key is gone -- including from
 * this device, which forgets the key as the last step (the caller signs out).
 *
 * Re-authentication comes first because deleting the sign-in account demands
 * a recent sign-in, and finding that out AFTER the data is gone would strand
 * a half-deleted account. Every step also tolerates having run before, so if
 * anything fails midway, trying again finishes the job.
 */
export async function deleteAccount(user: User, username: string): Promise<void> {
  await confirmIdentity(user);
  const uid = user.uid;

  // Unregister this browser from push while the account doc still exists.
  await disablePush(uid).catch(() => undefined);

  // Hidden lists first, in batches of their own: someone with hundreds of
  // chats would otherwise overflow the main batch.
  const hidden = await getDocs(query(collectionGroup(db(), 'hidden'), where('uid', '==', uid)));
  for (let start = 0; start < hidden.docs.length; start += BATCH_LIMIT) {
    const batch = writeBatch(db());
    hidden.docs.slice(start, start + BATCH_LIMIT).forEach((entry) => batch.delete(entry.ref));
    await batch.commit();
  }

  // Claims are deleted only if they are still there and still ours: on a
  // retry they are already gone, and the rules check the claim's owner, so a
  // blind delete would refuse the whole batch.
  const contact = await getDoc(doc(db(), 'users', uid, 'shared', 'contact'));
  const phone = (contact.data() as ContactDoc | undefined)?.phone ?? null;
  const [phoneClaim, handleClaim] = await Promise.all([
    phone ? getDoc(doc(db(), 'phones', phone)) : Promise.resolve(null),
    getDoc(doc(db(), 'usernames', username)),
  ]);

  const batch = writeBatch(db());
  if (phone && phoneClaim?.data()?.uid === uid) batch.delete(doc(db(), 'phones', phone));
  batch.delete(doc(db(), 'users', uid, 'shared', 'contact'));
  batch.delete(doc(db(), 'users', uid, 'private', 'account'));
  batch.delete(doc(db(), 'users', uid, 'private', 'recovery'));
  batch.delete(doc(db(), 'users', uid));
  // The rules release a handle only alongside its profile, in this batch.
  if (handleClaim.data()?.uid === uid) batch.delete(doc(db(), 'usernames', username));
  await batch.commit();

  await forgetPresence(uid).catch(() => undefined);

  // The data is gone; the sign-in account must follow, or signing in again
  // would start a fresh profile on the same uid. A dropped connection gets a
  // couple more tries before giving up.
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await user.delete();
      return;
    } catch (cause) {
      lastError = cause;
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
  throw lastError;
}
