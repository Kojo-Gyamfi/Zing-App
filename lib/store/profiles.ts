'use client';

import { create } from 'zustand';
import { getCachedUser, getUser } from '@/lib/db/users';
import type { UserDoc } from '@/lib/db/schema';

/**
 * Profile cache.
 *
 * Without this the chat list does one Firestore read per row on every render
 * pass -- the classic N+1 that makes a list feel sluggish and burns the free
 * read quota for no reason.
 *
 * Two tiers. The list only shows a name and a photo, so it takes Firestore's
 * offline copy when this device fetched that profile from the server within
 * REFRESH_MS -- otherwise every app launch re-read every peer. The open thread
 * asks for `fresh`: it checks the peer's public key for changes, and that
 * warning must not wait on a stale copy, so it goes to the server once per
 * session per peer.
 */
const REFRESH_MS = 12 * 60 * 60 * 1000;

type ProfileState = {
  profiles: Record<string, UserDoc>;
  /** Profiles confirmed not to exist: the account was deleted. */
  missing: Record<string, true>;
  /** Fetched from the server this session, so good enough for `fresh`. */
  verified: Record<string, true>;
  pending: Record<string, Promise<UserDoc | null>>;
  load: (uid: string, options?: { fresh?: boolean }) => Promise<UserDoc | null>;
};

export const useProfiles = create<ProfileState>((set, get) => ({
  profiles: {},
  missing: {},
  verified: {},
  pending: {},

  load: async (uid, { fresh = false } = {}) => {
    const state = get();
    if (state.missing[uid]) return null;
    const have = state.profiles[uid];
    if (have && (!fresh || state.verified[uid])) return have;

    // A server fetch in flight satisfies anyone; a cache lookup only a caller
    // that did not ask for fresh.
    const inFlight = state.pending[`${uid}:server`] ?? (fresh ? undefined : state.pending[`${uid}:any`]);
    if (inFlight) return inFlight;

    const settle = (profile: UserDoc | null, outcome: { missing?: boolean; verified?: boolean }) => {
      set((current) => {
        const pending = { ...current.pending };
        delete pending[`${uid}:server`];
        delete pending[`${uid}:any`];
        return {
          pending,
          profiles: profile ? { ...current.profiles, [uid]: profile } : current.profiles,
          missing: outcome.missing ? { ...current.missing, [uid]: true } : current.missing,
          verified: outcome.verified ? { ...current.verified, [uid]: true } : current.verified,
        };
      });
      return profile;
    };

    // A failed read (offline with nothing cached) must not stay pending, or
    // every later load would get the same rejected promise for the session --
    // and it says nothing about whether the account exists. Keep whatever
    // copy we already had.
    const fromServer = () =>
      getUser(uid).then(
        (profile) => {
          rememberFetched(uid);
          return settle(profile, { missing: profile === null, verified: true });
        },
        () => settle(get().profiles[uid] ?? null, {}),
      );

    const tier = !fresh && fetchedRecently(uid) ? 'any' : 'server';
    const request =
      tier === 'any'
        ? getCachedUser(uid).then((profile) => (profile ? settle(profile, {}) : fromServer()))
        : fromServer();

    set((current) => ({ pending: { ...current.pending, [`${uid}:${tier}`]: request } }));
    return request;
  },
}));

/**
 * When each profile was last fetched from the server, per device. Firestore's
 * cache does not say how old a copy is, so this does. Storage that is blocked
 * or cleared just means a server read, as before.
 */
const FETCHED_KEY = 'zing:profiles-fetched';

function readFetched(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(FETCHED_KEY) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

function fetchedRecently(uid: string): boolean {
  const at = readFetched()[uid];
  return typeof at === 'number' && Date.now() - at < REFRESH_MS;
}

function rememberFetched(uid: string): void {
  try {
    localStorage.setItem(FETCHED_KEY, JSON.stringify({ ...readFetched(), [uid]: Date.now() }));
  } catch {
    // Private mode or full storage: the next launch reads from the server.
  }
}
