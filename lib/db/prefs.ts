import {
  arrayRemove,
  arrayUnion,
  deleteField,
  doc,
  onSnapshot,
  setDoc,
  Timestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import {
  DEFAULT_APPEARANCE,
  toAppearance,
  toChatThemes,
  type Appearance,
  type ChatTheme,
} from '@/lib/appearance';
import { muteEnds, type MuteDuration } from '@/lib/mute';
import { cleanNickname, toNicknames } from '@/lib/names';
import { DEFAULT_PROOFREAD, toProofread, type Proofread } from '@/lib/proofread';
import { DEFAULT_PRIVACY, type AccountDoc, type Privacy } from './schema';

/**
 * Pinned, muted, archived and favourite chats. Owner-only, on
 * users/{uid}/private/account -- see AccountDoc for why that doc and not one
 * of its own. Each is a list of chat ids changed with arrayUnion/arrayRemove,
 * so two devices toggling different chats at once cannot overwrite each other.
 */
export type ChatPrefs = {
  pinned: string[];
  /** Muted for good. Timed mutes are in mutedUntil; see lib/mute.ts. */
  muted: string[];
  mutedUntil: Record<string, Date>;
  archived: string[];
  favourites: string[];
};

/** The id-list preferences, the ones setChatPref toggles. */
export type ChatListPref = 'pinned' | 'muted' | 'archived' | 'favourites';

export const NO_PREFS: ChatPrefs = {
  pinned: [],
  muted: [],
  mutedUntil: {},
  archived: [],
  favourites: [],
};

/** Everything on the account doc the app reads, with defaults filled in. */
export type AccountSettings = {
  prefs: ChatPrefs;
  privacy: Privacy;
  blocked: string[];
  /** Own photo while it is off the public profile; undefined when it is not. */
  photoURL: string | null | undefined;
  appearance: Appearance;
  /** Per-chat wallpaper and bubble colour, by chat id. */
  chatThemes: Record<string, ChatTheme>;
  /** My names for other people, by uid. */
  nicknames: Record<string, string>;
  proofread: Proofread;
};

export const NO_ACCOUNT: AccountSettings = {
  prefs: NO_PREFS,
  privacy: DEFAULT_PRIVACY,
  blocked: [],
  photoURL: undefined,
  appearance: DEFAULT_APPEARANCE,
  chatThemes: {},
  nicknames: {},
  proofread: DEFAULT_PROOFREAD,
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
            mutedUntil: Object.fromEntries(
              Object.entries(data?.mutedUntil ?? {}).flatMap(([chatId, until]) =>
                until instanceof Timestamp ? [[chatId, until.toDate()]] : [],
              ),
            ),
            archived: data?.archived ?? [],
            favourites: data?.favourites ?? [],
          },
          privacy: { ...DEFAULT_PRIVACY, ...data?.privacy },
          blocked: data?.blocked ?? [],
          photoURL: data?.photoURL,
          appearance: toAppearance(data?.appearance),
          chatThemes: toChatThemes(data?.chatThemes),
          nicknames: toNicknames(data?.nicknames),
          proofread: toProofread(data?.proofread),
        },
        snapshot.exists() || !snapshot.metadata.fromCache,
      );
    },
    () => onChange(NO_ACCOUNT, true),
  );
}

export async function setChatPref(
  uid: string,
  pref: ChatListPref,
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

/**
 * Mute a chat for 8 hours, a week or for good -- or unmute it with null. One
 * write that also clears the other form, so a chat is never both. The end of
 * a timed mute uses this device's clock; it is only this user's preference.
 */
export async function setMute(uid: string, chatId: string, duration: MuteDuration | null): Promise<void> {
  await setDoc(
    accountRef(uid),
    duration === 'always'
      ? { muted: arrayUnion(chatId), mutedUntil: { [chatId]: deleteField() } }
      : duration
        ? {
            muted: arrayRemove(chatId),
            mutedUntil: { [chatId]: Timestamp.fromDate(muteEnds(duration)) },
          }
        : { muted: arrayRemove(chatId), mutedUntil: { [chatId]: deleteField() } },
    { merge: true },
  );
}

/**
 * One chat's wallpaper or bubble colour. A field set to null goes back to the
 * default; null for the whole theme resets both.
 */
export async function setChatTheme(
  uid: string,
  chatId: string,
  patch: { wallpaper?: ChatTheme['wallpaper'] | null; bubble?: ChatTheme['bubble'] | null } | null,
): Promise<void> {
  const theme = patch
    ? Object.fromEntries(
        Object.entries(patch).map(([field, value]) => [field, value ?? deleteField()]),
      )
    : deleteField();
  await setDoc(accountRef(uid), { chatThemes: { [chatId]: theme } }, { merge: true });
}

/**
 * Give someone a nickname only I see, or take it away with null (or a blank
 * name). Never shown to them: it lives on my owner-only account doc.
 */
export async function setNickname(uid: string, peerUid: string, name: string | null): Promise<void> {
  const clean = name === null ? null : cleanNickname(name);
  await setDoc(accountRef(uid), { nicknames: { [peerUid]: clean ?? deleteField() } }, { merge: true });
}

/** Spelling and grammar checking: on or off, and which English. */
export async function setProofread(uid: string, patch: Partial<Proofread>): Promise<void> {
  await setDoc(accountRef(uid), { proofread: patch }, { merge: true });
}

/** Theme or wallpaper. Merged field by field, so one never resets the other. */
export async function setAppearance(uid: string, patch: Partial<Appearance>): Promise<void> {
  await setDoc(accountRef(uid), { appearance: patch }, { merge: true });
}
