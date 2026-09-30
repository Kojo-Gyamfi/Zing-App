'use client';

import { create } from 'zustand';
import { loadConversationKey } from '@/lib/db/chats';
import type { Identity } from '@/lib/crypto/types';

/**
 * Session cache of unsealed conversation keys.
 *
 * Unsealing costs a Firestore read plus an X25519 operation, and the chat list
 * needs every key at once to decrypt its previews. Caching keeps that to one
 * fetch per conversation per session.
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

    const request = loadConversationKey(chatId, uid, identity).then((key) => {
      if (key) {
        set((state) => ({ keys: { ...state.keys, [chatId]: key } }));
      } else {
        set((state) => ({ misses: { ...state.misses, [chatId]: Date.now() } }));
      }
      set((state) => {
        const pending = { ...state.pending };
        delete pending[chatId];
        return { pending };
      });
      return key;
    });

    set((state) => ({ pending: { ...state.pending, [chatId]: request } }));
    return request;
  },

  clear: () => set({ keys: {}, pending: {}, misses: {} }),
}));
