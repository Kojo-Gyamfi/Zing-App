'use client';

import { create } from 'zustand';
import type { ChatSummary } from '@/lib/db/chats';

/**
 * The chat docs the chat list is already listening to, shared with the open
 * thread.
 *
 * The list lives in the layout and stays subscribed for as long as the app is
 * open, so the thread can take its receipts from here instead of opening a
 * second listener on the same doc. Each listener is billed separately: with
 * two, every send, delivered tick and read tick was paid for twice per phone.
 */
type ChatsState = {
  /** Whose list this is. Null until the list has answered at least once. */
  owner: string | null;
  chats: Record<string, ChatSummary>;
  /**
   * Each chat as the server last confirmed it. While one of our own writes is
   * pending its receipt timestamps are this device's clock, and comparing
   * against those is what caused the receipt write loop (see lib/receipts.ts).
   */
  confirmed: Record<string, ChatSummary>;
  publish: (owner: string, chats: ChatSummary[]) => void;
  reset: () => void;
};

export const useChats = create<ChatsState>((set) => ({
  owner: null,
  chats: {},
  confirmed: {},

  publish: (owner, list) =>
    set((state) => {
      const previous = state.owner === owner ? state.confirmed : {};
      const chats: Record<string, ChatSummary> = {};
      const confirmed: Record<string, ChatSummary> = {};
      for (const chat of list) {
        chats[chat.id] = chat;
        const settled = chat.pending ? previous[chat.id] : chat;
        if (settled) confirmed[chat.id] = settled;
      }
      return { owner, chats, confirmed };
    }),

  reset: () => set({ owner: null, chats: {}, confirmed: {} }),
}));
