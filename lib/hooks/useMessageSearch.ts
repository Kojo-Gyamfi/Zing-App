'use client';

import { useEffect, useState } from 'react';
import { cachedMessages, hasExpired } from '@/lib/db/messages';
import { isHidden, NOTHING_HIDDEN, type HiddenList } from '@/lib/hidden';
import { isLocation } from '@/lib/location';
import { normalizeForSearch } from '@/lib/search';
import { useKeys } from '@/lib/store/keys';
import { useSession } from '@/lib/store/session';
import type { DecryptedMessage } from '@/lib/db/schema';

export type MessageHit = { chatId: string; message: DecryptedMessage };

const PAUSE_MS = 250;
const MAX_HITS = 50;

// Decrypted once per chat, and again only when that chat has moved on. In
// memory only, for this session: never written anywhere.
const decrypted = new Map<string, { version: number; messages: DecryptedMessage[] }>();

/**
 * Messages matching the search, across every chat in the list. Looks only
 * through what this device already holds (Firestore's offline cache),
 * decrypted here; the server is never asked, and could not search ciphertext
 * if it were. What I deleted for myself or cleared stays out, as do view-once
 * messages, shared locations and ones that have disappeared.
 */
export function useMessageSearch(
  query: string,
  chats: { id: string; updatedAt: Date | null }[],
  hidden: Map<string, HiddenList>,
) {
  const uid = useSession((state) => state.user?.uid);
  const identity = useSession((state) => state.identity);
  const [result, setResult] = useState<{ query: string; hits: MessageHit[] }>({ query: '', hits: [] });
  const needle = normalizeForSearch(query.trim());
  const active = needle.length >= 2 && !!uid && !!identity;

  useEffect(() => {
    if (!active || !uid || !identity) return;
    let live = true;
    const timer = setTimeout(async () => {
      const hits: MessageHit[] = [];
      for (const chat of chats) {
        const key = await useKeys.getState().get(chat.id, uid, identity).catch(() => null);
        if (!key || !live) continue;
        const version = chat.updatedAt?.getTime() ?? 0;
        let entry = decrypted.get(chat.id);
        if (!entry || entry.version !== version) {
          entry = { version, messages: await cachedMessages(chat.id, key) };
          decrypted.set(chat.id, entry);
        }
        const removed = hidden.get(chat.id) ?? NOTHING_HIDDEN;
        for (const message of entry.messages) {
          if (
            message.text === null ||
            message.deleted ||
            message.viewOnce ||
            isLocation(message.text) ||
            isHidden(message, removed) ||
            hasExpired(message)
          ) {
            continue;
          }
          if (normalizeForSearch(message.text).includes(needle)) hits.push({ chatId: chat.id, message });
        }
      }
      if (!live) return;
      hits.sort((a, b) => (b.message.createdAt?.getTime() ?? 0) - (a.message.createdAt?.getTime() ?? 0));
      setResult({ query: needle, hits: hits.slice(0, MAX_HITS) });
    }, PAUSE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [active, needle, chats, hidden, uid, identity]);

  return {
    hits: active && result.query === needle ? result.hits : [],
    searching: active && result.query !== needle,
  };
}
