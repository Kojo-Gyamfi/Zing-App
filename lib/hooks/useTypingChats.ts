'use client';

import { useEffect, useState } from 'react';
import { subscribeTyping } from '@/lib/db/presence';

/**
 * Which of these chats has the other person typing right now, for the chat
 * list's "typing…" in place of the preview. One small Realtime Database
 * listener per visible chat; they are cheap and carry no message content.
 */
export function useTypingChats(myUid: string | undefined, chatIds: string[]): Set<string> {
  const [typing, setTyping] = useState<Set<string>>(() => new Set());
  // A string key, so a new array with the same chats does not resubscribe.
  const key = chatIds.join(',');

  useEffect(() => {
    if (!myUid || !key) return;
    const stops = key.split(',').map((chatId) => {
      // Direct chat ids are the two uids sorted and joined.
      const peerUid = chatId.split('_').find((uid) => uid !== myUid);
      if (!peerUid) return () => undefined;
      return subscribeTyping(chatId, peerUid, (isTyping) => {
        setTyping((current) => {
          if (current.has(chatId) === isTyping) return current;
          const next = new Set(current);
          if (isTyping) next.add(chatId);
          else next.delete(chatId);
          return next;
        });
      });
    });
    return () => {
      stops.forEach((stop) => stop());
      setTyping(new Set());
    };
  }, [myUid, key]);

  return typing;
}
