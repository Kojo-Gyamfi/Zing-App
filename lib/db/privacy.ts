import { arrayRemove, arrayUnion, deleteField, doc, setDoc, writeBatch } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import type { ContactPhotoDoc, PhotoVisibility, Privacy } from './schema';

const accountRef = (uid: string) => doc(db(), 'users', uid, 'private', 'account');
const photoRef = (uid: string) => doc(db(), 'users', uid, 'shared', 'photo');

/** Read receipts and last seen: owner-only switches on the account doc. */
export async function setPrivacy(
  uid: string,
  patch: Partial<Pick<Privacy, 'readReceipts' | 'lastSeen'>>,
): Promise<void> {
  await setDoc(accountRef(uid), { privacy: patch }, { merge: true });
}

/**
 * Who sees the profile photo. The public profile is readable by every
 * signed-in user, so hiding the photo means taking it off that doc:
 *
 *   everyone -- on the public profile, as before
 *   contacts -- at shared/photo, which the rules open only to people with a
 *               conversation where both have spoken (the phone number's rule)
 *   nobody   -- nowhere anyone else can read
 *
 * The owner's copy stays on the account doc in every case, so their own
 * avatar keeps it and switching back to "everyone" can restore it. One batch,
 * so the photo is never in two places or none.
 */
export async function setPhotoVisibility(
  uid: string,
  visibility: PhotoVisibility,
  photoURL: string | null,
): Promise<void> {
  const batch = writeBatch(db());
  const forContacts = visibility === 'contacts' && photoURL !== null;

  batch.update(doc(db(), 'users', uid), {
    photoURL: visibility === 'everyone' ? photoURL : null,
    contactPhoto: forContacts ? true : deleteField(),
  });
  if (forContacts) batch.set(photoRef(uid), { photoURL } satisfies ContactPhotoDoc);
  else batch.delete(photoRef(uid));
  batch.set(accountRef(uid), { privacy: { photo: visibility }, photoURL }, { merge: true });

  await batch.commit();
}

/**
 * Block or unblock the other member of a chat. The flag on the chat doc is
 * what the rules enforce; the list on the account doc is for Settings and the
 * push route. Written together so they cannot disagree.
 */
export async function setBlocked(
  uid: string,
  chatId: string,
  peerUid: string,
  on: boolean,
): Promise<void> {
  const batch = writeBatch(db());
  batch.update(doc(db(), 'chats', chatId), { [`blocked.${uid}`]: on ? true : deleteField() });
  batch.set(
    accountRef(uid),
    { blocked: on ? arrayUnion(peerUid) : arrayRemove(peerUid) },
    { merge: true },
  );
  await batch.commit();
}
