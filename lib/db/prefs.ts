import { arrayRemove, arrayUnion, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import type { AccountDoc } from './schema';

/**
 * Pinned, muted and archived chats. Owner-only, on users/{uid}/private/account
 * -- see AccountDoc for why that doc and not one of its own. Each is a list of
 * chat ids changed with arrayUnion/arrayRemove, so two devices toggling
 * different chats at once cannot overwrite each other.
 */
export type ChatPrefs = {
  pinned: string[];
  muted: string[];
  archived: string[];
};

export const NO_PREFS: ChatPrefs = { pinned: [], muted: [], archived: [] };

const accountRef = (uid: string) => doc(db(), 'users', uid, 'private', 'account');

export function subscribeChatPrefs(uid: string, onChange: (prefs: ChatPrefs) => void) {
  return onSnapshot(
    accountRef(uid),
    (snapshot) => {
      const data = snapshot.data() as AccountDoc | undefined;
      onChange({
        pinned: data?.pinned ?? [],
        muted: data?.muted ?? [],
        archived: data?.archived ?? [],
      });
    },
    () => onChange(NO_PREFS),
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
