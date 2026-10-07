'use client';

import { create } from 'zustand';

/**
 * Unsent text, per chat, kept in this browser's localStorage. It is
 * plaintext, and it never leaves the device: not written to Firestore, not
 * synced to the account's other devices. Signing out wipes it, so the next
 * person on this phone cannot read what was half-typed.
 *
 * A store rather than bare localStorage so the chat list can show
 * "Draft: ..." the moment the thread changes it.
 */
const PREFIX = 'zing:drafts:';

type DraftsState = {
  owner: string | null;
  drafts: Record<string, string>;
  /** Load one account's drafts. Called when its chat list mounts. */
  open: (uid: string) => void;
  set: (uid: string, chatId: string, text: string) => void;
};

export const useDrafts = create<DraftsState>((set, get) => ({
  owner: null,
  drafts: {},

  open: (uid) => {
    if (get().owner === uid) return;
    set({ owner: uid, drafts: read(uid) });
  },

  set: (uid, chatId, text) => {
    const current = get().owner === uid ? get().drafts : read(uid);
    const drafts = { ...current };
    // Whitespace alone is not worth keeping, or showing as a draft.
    if (text.trim()) drafts[chatId] = text;
    else delete drafts[chatId];
    set({ owner: uid, drafts });
    try {
      if (Object.keys(drafts).length) localStorage.setItem(PREFIX + uid, JSON.stringify(drafts));
      else localStorage.removeItem(PREFIX + uid);
    } catch {
      // Private mode or full storage: the draft lives until the tab closes.
    }
  },
}));

/**
 * One chat's draft, for a composer that is about to mount. Reads without
 * touching the store, so it is safe during render.
 */
export function draftFor(uid: string, chatId: string): string {
  const state = useDrafts.getState();
  return (state.owner === uid ? state.drafts : read(uid))[chatId] ?? '';
}

function read(uid: string): Record<string, string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(PREFIX + uid) ?? '{}') as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** Every account's drafts on this device. For sign-out. */
export function clearDrafts(): void {
  useDrafts.setState({ owner: null, drafts: {} });
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    // Nothing stored, or nothing we can reach.
  }
}
