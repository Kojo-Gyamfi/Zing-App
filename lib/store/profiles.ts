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
  pending: Record<string, Promise<UserDoc | null>>;
  load: (uid: string) => Promise<UserDoc | null>;
};

export const useProfiles = create<ProfileState>((set, get) => ({
  profiles: {},
  pending: {},

  load: async (uid) => {
    const cached = get().profiles[uid];
    if (cached) return cached;

    const inFlight = get().pending[uid];
    if (inFlight) return inFlight;

    const request = getUser(uid).then((profile) => {
      set((state) => {
        const pending = { ...state.pending };
        delete pending[uid];
        return {
          pending,
          profiles: profile ? { ...state.profiles, [uid]: profile } : state.profiles,
        };
      });
      return profile;
    });

    set((state) => ({ pending: { ...state.pending, [uid]: request } }));
    return request;
  },
}));
