import { arrayRemove, arrayUnion, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { DEFAULT_APPEARANCE, toAppearance, type Appearance } from '@/lib/appearance';
import { DEFAULT_PRIVACY, type AccountDoc, type Privacy } from './schema';

/**
 * Pinned, muted, archived and favourite chats. Owner-only, on
 * users/{uid}/private/account -- see AccountDoc for why that doc and not one
 * of its own. Each is a list of chat ids changed with arrayUnion/arrayRemove,
 * so two devices toggling different chats at once cannot overwrite each other.
 */
export type ChatPrefs = {
  pinned: string[];
  muted: string[];
  archived: string[];
  favourites: string[];
};

export const NO_PREFS: ChatPrefs = { pinned: [], muted: [], archived: [], favourites: [] };

/** Everything on the account doc the app reads, with defaults filled in. */
export type AccountSettings = {
  prefs: ChatPrefs;
  privacy: Privacy;
  blocked: string[];
  /** Own photo while it is off the public profile; undefined when it is not. */
  photoURL: string | null | undefined;
  appearance: Appearance;
};

export const NO_ACCOUNT: AccountSettings = {
  prefs: NO_PREFS,
  privacy: DEFAULT_PRIVACY,
  blocked: [],
  photoURL: undefined,
  appearance: DEFAULT_APPEARANCE,
};

const accountRef = (uid: string) => doc(db(), 'users', uid, 'private', 'account');

/**
 * The account doc, live. `known` is false for an offline cache miss: the doc
 * is created at sign-up, so "not there" from the cache means "not fetched
 * yet", and acting on the defaults (publishing presence, say) would be wrong.
 *
 * A refused listener is a different matter -- it will not come back -- so it
 * reports the defaults as known, and the app behaves as it did before these
 * settings existed rather than holding back receipts forever.
 */
export function subscribeAccount(
  uid: string,
  onChange: (settings: AccountSettings, known: boolean) => void,
) {
  return onSnapshot(
    accountRef(uid),
    (snapshot) => {
      const data = snapshot.data() as AccountDoc | undefined;
      onChange(
        {
          prefs: {
            pinned: data?.pinned ?? [],
            muted: data?.muted ?? [],
            archived: data?.archived ?? [],
            favourites: data?.favourites ?? [],
          },
          privacy: { ...DEFAULT_PRIVACY, ...data?.privacy },
          blocked: data?.blocked ?? [],
          photoURL: data?.photoURL,
          appearance: toAppearance(data?.appearance),
        },
        snapshot.exists() || !snapshot.metadata.fromCache,
      );
    },
    () => onChange(NO_ACCOUNT, true),
  );
}

export async function setChatPref(
  uid: string,
  pref: keyof ChatPrefs,
  chatId: string,
  on: boolean,
): Promise<void> {
  const change = on ? arrayUnion(chatId) : arrayRemove(chatId);
  // Archiving takes a chat off the pinned list, as WhatsApp does: a pinned
  // chat you cannot see would still hold one of the few pin slots.
  await setDoc(
    accountRef(uid),
    pref === 'archived' && on ? { archived: change, pinned: arrayRemove(chatId) } : { [pref]: change },
    { merge: true },
  );
}

/** Theme or wallpaper. Merged field by field, so one never resets the other. */
export async function setAppearance(uid: string, patch: Partial<Appearance>): Promise<void> {
  await setDoc(accountRef(uid), { appearance: patch }, { merge: true });
}
