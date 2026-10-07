'use client';

import { create } from 'zustand';
import { NO_ACCOUNT, subscribeAccount, type AccountSettings } from '@/lib/db/prefs';

/**
 * The signed-in user's own account doc (users/{uid}/private/account): chat
 * preferences, privacy settings, the block list and a hidden photo.
 *
 * One listener for the whole app, started by the session, because the
 * session itself needs the privacy settings -- presence is published only
 * while last seen is shared. Screens read from here instead of listening to
 * the doc themselves.
 */
type AccountState = {
  /** Whose settings these are. Null when signed out. */
  owner: string | null;
  /** False until the doc has been read (see subscribeAccount). */
  known: boolean;
  settings: AccountSettings;
};

export const useAccount = create<AccountState>(() => ({
  owner: null,
  known: false,
  settings: NO_ACCOUNT,
}));

/** Start listening for one account. Returns a teardown that forgets it. */
export function watchAccount(
  uid: string,
  onChange: (settings: AccountSettings, known: boolean) => void,
): () => void {
  useAccount.setState({ owner: uid, known: false, settings: NO_ACCOUNT });
  const stop = subscribeAccount(uid, (settings, known) => {
    useAccount.setState({ owner: uid, known, settings });
    onChange(settings, known);
  });
  return () => {
    stop();
    useAccount.setState({ owner: null, known: false, settings: NO_ACCOUNT });
  };
}

/** This user's privacy settings, defaults until the doc is read. */
export function usePrivacy() {
  return useAccount((state) => state.settings.privacy);
}

/**
 * The photo to show for myself. The public profile has none while it is
 * hidden from some people; the real one is kept on the account doc.
 */
export function useMyPhoto(publicPhoto: string | null | undefined): string | null {
  const hidden = useAccount((state) => state.settings.photoURL);
  return hidden ?? publicPhoto ?? null;
}
