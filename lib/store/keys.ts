'use client';

import { create } from 'zustand';
import { loadConversationKey } from '@/lib/db/chats';
import type { Identity } from '@/lib/crypto/types';

/**
 * Session cache of unsealed conversation keys.
 *
 * Unsealing costs a key-doc lookup plus an X25519 operation, and the chat list
 * needs every key at once to decrypt its previews. Caching keeps that to one
 * lookup per conversation per session -- and the lookup itself is served from
 * Firestore's offline cache once this device has seen the key (see
 * loadConversationKey), so it is a billed read only the first time.
 *
 * Deliberately memory-only: keys are never written back to disk, so closing
 * the tab discards them. The private key in IndexedDB can always re-derive
 * them.
 */
/**
 * A key that is not there yet (the other side is still writing it) is worth
 * re-checking, but not on every chat-list snapshot -- that was one read per
 * snapshot per such chat.
 */
const MISS_TTL_MS = 5000;

type KeyState = {
  keys: Record<string, Uint8Array>;
  pending: Record<string, Promise<Uint8Array | null>>;
  misses: Record<string, number>;
  get: (chatId: string, uid: string, identity: Identity) => Promise<Uint8Array | null>;
  forgetMiss: (chatId: string) => void;
  clear: () => void;
};

export const useKeys = create<KeyState>((set, get) => ({
  keys: {},
  pending: {},
  misses: {},

  get: async (chatId, uid, identity) => {
    const cached = get().keys[chatId];
    if (cached) return cached;

    const missedAt = get().misses[chatId];
    if (missedAt && Date.now() - missedAt < MISS_TTL_MS) return null;

    // Collapse concurrent requests -- the chat list asks for the same key from
    // several rows at once on first paint.
    const inFlight = get().pending[chatId];
    if (inFlight) return inFlight;

    const settle = (key: Uint8Array | null) => {
      set((state) => {
        const pending = { ...state.pending };
        delete pending[chatId];
        return key
          ? { pending, keys: { ...state.keys, [chatId]: key } }
          : { pending, misses: { ...state.misses, [chatId]: Date.now() } };
      });
      return key;
    };

    // A failed read (offline, nothing cached) counts as a miss. Left pending,
    // every later ask in the session would get the same rejection.
    const request = loadConversationKey(chatId, uid, identity).then(settle, () => settle(null));

    set((state) => ({ pending: { ...state.pending, [chatId]: request } }));
    return request;
  },

  /**
   * The key doc has just appeared: drop the remembered miss -- and any request
   * still in flight from before it existed, which would answer null -- so the
   * next get() reads it fresh.
   */
  forgetMiss: (chatId) =>
    set((state) => {
      const misses = { ...state.misses };
      const pending = { ...state.pending };
      delete misses[chatId];
      delete pending[chatId];
      return { misses, pending };
    }),

  clear: () => set({ keys: {}, pending: {}, misses: {} }),
}));
