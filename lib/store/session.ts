'use client';

import { create } from 'zustand';
import { onAuthStateChanged, signOut as firebaseSignOut, type User } from 'firebase/auth';
import { auth } from '@/lib/firebase/client';
import { getUser, migrateLegacyContact } from '@/lib/db/users';
import { loadIdentity, clearIdentity } from '@/lib/crypto/vault';
import { publicKeyFrom } from '@/lib/crypto/identity';
import { toB64 } from '@/lib/crypto/codec';
import { trackPresence } from '@/lib/db/presence';
import type { Identity } from '@/lib/crypto/types';
import type { UserDoc } from '@/lib/db/schema';

/**
 * Zing has two independent notions of "signed in", and the UI has to respect
 * both:
 *
 *   account  -- Firebase Auth says who you are
 *   identity -- this device holds the private key that can read your messages
 *
 * You can have the first without the second (new phone, cleared storage,
 * Safari eviction). That is the `locked` state, and it is a normal thing to be
 * in, not an error.
 */
export type SessionStatus =
  | 'loading'
  | 'signedOut'
  | 'needsProfile' // account exists, no Zing profile yet -> onboarding
  | 'locked'       // profile exists, but no key on this device -> passphrase
  | 'ready';

type SessionState = {
  status: SessionStatus;
  user: User | null;
  profile: UserDoc | null;
  identity: Identity | null;

  start: () => () => void;
  refreshProfile: () => Promise<void>;
  setIdentity: (identity: Identity, profile: UserDoc) => void;
  signOut: () => Promise<void>;
};

/** Set when migrateLegacyContact had to drop a number; Settings asks for it again. */
export const phoneDroppedFlag = (uid: string) => `zing.phone.dropped.${uid}`;

/**
 * Moves an early account's phone number out of its public profile and into
 * canonical form (see migrateLegacyContact). Once per account per device:
 * after that it is a no-op that would still cost several reads every launch.
 * The v2 flag re-runs it for accounts that took the first, pre-E.164 version.
 */
function migrateOnce(uid: string) {
  const flag = `zing.contact.migrated.v2.${uid}`;
  try {
    if (localStorage.getItem(flag)) return;
  } catch {
    // No storage: run it; the transaction exits early when there is nothing to do.
  }

  void migrateLegacyContact(uid)
    .then((dropped) => {
      try {
        localStorage.setItem(flag, '1');
        if (dropped) localStorage.setItem(phoneDroppedFlag(uid), '1');
      } catch {
        // Runs again next launch; harmless.
      }
    })
    .catch(() => {
      // Offline or over quota: try again next launch.
    });
}

export const useSession = create<SessionState>((set, get) => ({
  status: 'loading',
  user: null,
  profile: null,
  identity: null,

  /** Mounted once by the app shell. Returns a teardown. */
  start: () => {
    let stopPresence: (() => void) | null = null;

    const stopAuth = onAuthStateChanged(auth(), async (user) => {
      stopPresence?.();
      stopPresence = null;

      if (!user) {
        set({ status: 'signedOut', user: null, profile: null, identity: null });
        return;
      }

      const profile = await getUser(user.uid);
      if (!profile) {
        set({ status: 'needsProfile', user, profile: null, identity: null });
        return;
      }

      const identity = await loadIdentity();

      // A local key that does not match the registered public key is stale --
      // treat it as no key at all rather than silently failing to decrypt
      // every message.
      const matches =
        identity !== null &&
        (await toB64(await publicKeyFrom(identity.privateKey))) === profile.publicKey;

      if (!matches) {
        set({ status: 'locked', user, profile, identity: null });
        return;
      }

      stopPresence = trackPresence(user.uid);
      set({ status: 'ready', user, profile, identity });
      migrateOnce(user.uid);
    });

    return () => {
      stopAuth();
      stopPresence?.();
    };
  },

  refreshProfile: async () => {
    const { user } = get();
    if (!user) return;
    set({ profile: await getUser(user.uid) });
  },

  setIdentity: (identity, profile) => {
    const { user } = get();
    if (user) {
      trackPresence(user.uid);
      migrateOnce(user.uid);
    }
    set({ status: 'ready', identity, profile });
  },

  /**
   * Signing out wipes the device key. The Firestore backup survives, so the
   * passphrase brings everything back -- but this is the moment someone who
   * never wrote their passphrase down loses their history, so the UI warns.
   */
  signOut: async () => {
    await clearIdentity();
    await firebaseSignOut(auth());
    set({ status: 'signedOut', user: null, profile: null, identity: null });
  },
}));
