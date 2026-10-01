'use client';

import { create } from 'zustand';
import { getUser } from '@/lib/db/users';
import type { UserDoc } from '@/lib/db/schema';

/**
 * Profile cache.
 *
 * Without this the chat list does one Firestore read per row on every render
 * pass -- the classic N+1 that makes a list feel sluggish and burns the free
 * read quota for no reason.
 */
type ProfileState = {
  profiles: Record<string, UserDoc>;
  /** Profiles confirmed not to exist: the account was deleted. */
  missing: Record<string, true>;
  pending: Record<string, Promise<UserDoc | null>>;
  load: (uid: string) => Promise<UserDoc | null>;
};

export const useProfiles = create<ProfileState>((set, get) => ({
  profiles: {},
  missing: {},
  pending: {},

  load: async (uid) => {
    const cached = get().profiles[uid];
    if (cached) return cached;
    if (get().missing[uid]) return null;

    const inFlight = get().pending[uid];
    if (inFlight) return inFlight;

    const settle = (profile: UserDoc | null, confirmedMissing: boolean) => {
      set((state) => {
        const pending = { ...state.pending };
        delete pending[uid];
        return {
          pending,
          profiles: profile ? { ...state.profiles, [uid]: profile } : state.profiles,
          missing: confirmedMissing ? { ...state.missing, [uid]: true } : state.missing,
        };
      });
      return profile;
    };

    // A failed read (offline with nothing cached) must not stay pending, or
    // every later load would get the same rejected promise for the session --
    // and it says nothing about whether the account exists.
    const request = getUser(uid).then(
      (profile) => settle(profile, profile === null),
      () => settle(null, false),
    );

    set((state) => ({ pending: { ...state.pending, [uid]: request } }));
    return request;
  },
}));
