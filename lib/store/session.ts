'use client';

import { create } from 'zustand';
import { onAuthStateChanged, signOut as firebaseSignOut, type User } from 'firebase/auth';
import { auth } from '@/lib/firebase/client';
import { getUser } from '@/lib/db/users';
import { loadIdentity, clearIdentity } from '@/lib/crypto/vault';
import { publicKeyFrom } from '@/lib/crypto/identity';
import { toB64 } from '@/lib/crypto/codec';
import { trackPresence } from '@/lib/db/presence';
import { disablePush } from '@/lib/push';
import { useKeys } from '@/lib/store/keys';
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

/**
 * Presence is tracked for exactly one account at a time. Both ways of reaching
 * `ready` (launch, and unlocking/onboarding) go through here, and so does
 * every way out, so a second tracker never leaks.
 */
let stopPresence: ((markOffline?: boolean) => void) | null = null;

function startPresence(uid: string) {
  stopPresence?.();
  stopPresence = trackPresence(uid);
}

/**
 * markOffline false when the sign-in is already gone (signed out elsewhere,
 * account deleted): the write would be refused, so don't try.
 */
function endPresence(markOffline = true) {
  stopPresence?.(markOffline);
  stopPresence = null;
}

export const useSession = create<SessionState>((set, get) => ({
  status: 'loading',
  user: null,
  profile: null,
  identity: null,

  /** Mounted once by the app shell. Returns a teardown. */
  start: () => {
    let retry: ReturnType<typeof setTimeout> | null = null;
    // Bumped on every auth change. resolve() awaits several reads; if the
    // user signs out (or switches) meanwhile, its late answer must not land.
    let generation = 0;

    async function resolve(user: User, mine: number) {
      const stale = () => mine !== generation;

      let profile: UserDoc | null;
      try {
        profile = await getUser(user.uid);
      } catch {
        // Offline on first launch, with nothing cached yet. Stay on the
        // splash and try again rather than sending a real account to
        // onboarding.
        if (!stale()) retry = setTimeout(() => void resolve(user, mine), 3000);
        return;
      }
      if (stale()) return;

      if (!profile) {
        set({ status: 'needsProfile', user, profile: null, identity: null });
        return;
      }

      // Storage that cannot be opened is treated as "no key on this device"
      // (the unlock screen), not left to hang the app on its splash.
      const identity = await loadIdentity().catch(() => null);

      // A local key that does not match the registered public key is stale --
      // treat it as no key at all rather than silently failing to decrypt
      // every message.
      const matches =
        identity !== null &&
        (await toB64(await publicKeyFrom(identity.privateKey))) === profile.publicKey;
      if (stale()) return;

      if (!matches) {
        set({ status: 'locked', user, profile, identity: null });
        return;
      }

      startPresence(user.uid);
      set({ status: 'ready', user, profile, identity });
    }

    const stopAuth = onAuthStateChanged(auth(), (user) => {
      const mine = ++generation;
      // By now auth has already changed; a presence write would be refused.
      endPresence(false);
      if (retry) clearTimeout(retry);
      retry = null;

      if (!user) {
        // Unsealed conversation keys live in memory for the session; signing
        // out must not leave them behind in a tab that stays open.
        useKeys.getState().clear();
        set({ status: 'signedOut', user: null, profile: null, identity: null });
        return;
      }
      void resolve(user, mine);
    });

    return () => {
      stopAuth();
      if (retry) clearTimeout(retry);
      endPresence();
    };
  },

  refreshProfile: async () => {
    const { user } = get();
    if (!user) return;
    const profile = await getUser(user.uid).catch(() => null);
    // Keep what we have rather than blanking the app on a failed read.
    if (profile) set({ profile });
  },

  setIdentity: (identity, profile) => {
    const { user } = get();
    if (user) startPresence(user.uid);
    set({ status: 'ready', identity, profile });
  },

  /**
   * Signing out wipes the device key. The Firestore backup survives, so the
   * passphrase brings everything back -- but this is the moment someone who
   * never wrote their passphrase down loses their history, so the UI warns.
   */
  signOut: async () => {
    // Unregister this device from push while still signed in (the rules need
    // the auth). Capped: offline, the Firestore write would wait forever.
    const { user } = get();
    if (user) {
      await Promise.race([
        disablePush(user.uid).catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);
    }
    endPresence();
    await clearIdentity();
    await firebaseSignOut(auth());
    useKeys.getState().clear();
    set({ status: 'signedOut', user: null, profile: null, identity: null });
  },
}));
