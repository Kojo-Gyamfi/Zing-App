'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from '@/lib/store/session';
import { useKeys } from '@/lib/store/keys';
import { useProfiles } from '@/lib/store/profiles';
import {
  subscribeMessages,
  sendMessage as send,
  loadOlderMessages,
  PAGE_SIZE,
} from '@/lib/db/messages';
import { markRead, subscribeChat } from '@/lib/db/chats';
import { notifyPeers } from '@/lib/notify';
import { subscribePresence, subscribeTyping, setTyping, type Presence } from '@/lib/db/presence';
import type { DecryptedMessage, UserDoc } from '@/lib/db/schema';

const TYPING_THROTTLE = 2000;

/**
 * Everything one conversation needs: the key, the decrypted messages, the
 * peer's profile, their presence and their typing state.
 */
export function useThread(chatId: string, peerUid: string | null) {
  const { user, identity } = useSession();
  const keyFor = useKeys((state) => state.get);
  const loadProfile = useProfiles((state) => state.load);

  const [conversationKey, setConversationKey] = useState<Uint8Array | null>(null);
  const [messages, setMessages] = useState<DecryptedMessage[]>([]);
  const [older, setOlder] = useState<DecryptedMessage[]>([]);
  const [peer, setPeer] = useState<UserDoc | null>(null);
  const [presence, setPresence] = useState<Presence>({ online: false, lastSeen: null });
  const [peerTyping, setPeerTyping] = useState(false);
  const [loading, setLoading] = useState(true);
  const [exhausted, setExhausted] = useState(false);
  const [peerReadAt, setPeerReadAt] = useState<Date | null>(null);
  const [peerDeliveredAt, setPeerDeliveredAt] = useState<Date | null>(null);
  const [failed, setFailed] = useState<(DecryptedMessage & { chatId: string })[]>([]);

  const lastTypingPing = useRef(0);

  useEffect(() => {
    if (!user || !identity) return;
    let live = true;

    void keyFor(chatId, user.uid, identity).then((key) => {
      if (live) setConversationKey(key);
    });

    return () => {
      live = false;
    };
  }, [chatId, user, identity, keyFor]);

  useEffect(() => {
    if (!peerUid) return;
    void loadProfile(peerUid).then(setPeer);

    const stopPresence = subscribePresence(peerUid, setPresence);
    const stopTyping = subscribeTyping(chatId, peerUid, setPeerTyping);

    return () => {
      stopPresence();
      stopTyping();
    };
  }, [peerUid, chatId, loadProfile]);

  // Receipts for the messages I sent, live while the thread is open.
  useEffect(() => {
    if (!peerUid) return;

    return subscribeChat(chatId, (chat) => {
      setPeerReadAt(chat?.lastRead?.[peerUid]?.toDate?.() ?? null);
      setPeerDeliveredAt(chat?.lastDelivered?.[peerUid]?.toDate?.() ?? null);
    });
  }, [chatId, peerUid]);

  useEffect(() => {
    if (!conversationKey) return;

    const unsubscribe = subscribeMessages(
      chatId,
      conversationKey,
      (next) => {
        setMessages(next);
        setLoading(false);
      },
      // A refused listener would otherwise leave the thread on its spinner.
      () => setLoading(false),
    );

    return unsubscribe;
  }, [chatId, conversationKey]);

  // One write per open, not per message. Also fires when new mail arrives
  // while the thread is already on screen.
  useEffect(() => {
    if (!user || loading) return;
    void markRead(chatId, user.uid);
  }, [chatId, user, loading, messages.length]);

  const sendText = useCallback(
    async (text: string) => {
      if (!user || !conversationKey || !text.trim()) return;

      setTyping(chatId, user.uid, false);
      lastTypingPing.current = 0;

      const sentAt = new Date();
      const { id, envelope, committed } = await send({
        chatId,
        senderId: user.uid,
        text: text.trim(),
        conversationKey,
      });

      committed.then(
        // Push only once the server has the message, so nobody is buzzed for
        // one that never landed. Offline, this waits for the reconnect.
        () => void notifyPeers(chatId, envelope),
        // Firestore has already rolled the local copy back; without this the
        // bubble would just vanish.
        () =>
          setFailed((current) => [
            ...current,
            {
              chatId,
              id,
              senderId: user.uid,
              text: text.trim(),
              createdAt: sentAt,
              replyTo: null,
              pending: false,
              failed: true,
            },
          ]),
      );
    },
    [chatId, user, conversationKey],
  );

  const retry = useCallback(
    (id: string) => {
      const message = failed.find((entry) => entry.id === id);
      if (!message?.text) return;

      setFailed((current) => current.filter((entry) => entry.id !== id));
      void sendText(message.text);
    },
    [failed, sendText],
  );

  const discard = useCallback((id: string) => {
    setFailed((current) => current.filter((entry) => entry.id !== id));
  }, []);

  /** Throttled: one RTDB write every couple of seconds, not one per keystroke. */
  const ping = useCallback(() => {
    if (!user) return;
    const now = Date.now();
    if (now - lastTypingPing.current < TYPING_THROTTLE) return;

    lastTypingPing.current = now;
    setTyping(chatId, user.uid, true);
  }, [chatId, user]);

  const loadOlder = useCallback(async () => {
    if (!conversationKey || exhausted) return;

    const oldest = (older[0] ?? messages[0])?.createdAt;
    if (!oldest) return;

    const page = await loadOlderMessages(chatId, conversationKey, oldest);
    if (page.length < PAGE_SIZE) setExhausted(true);
    setOlder((current) => [...page, ...current]);
  }, [chatId, conversationKey, older, messages, exhausted]);

  // Clear typing if the tab goes away mid-sentence.
  useEffect(() => {
    return () => {
      if (user) setTyping(chatId, user.uid, false);
    };
  }, [chatId, user]);

  const thread = [...older, ...messages];
  const failedHere = failed.filter(
    (entry) => entry.chatId === chatId && !thread.some((message) => message.id === entry.id),
  );

  return {
    messages: failedHere.length
      ? [...thread, ...failedHere].sort(
          // Unstamped messages are still in flight, so they belong at the end.
          (a, b) =>
            (a.createdAt?.getTime() ?? Number.MAX_SAFE_INTEGER) -
            (b.createdAt?.getTime() ?? Number.MAX_SAFE_INTEGER),
        )
      : thread,
    peer,
    presence,
    peerTyping,
    peerReadAt,
    peerDeliveredAt,
    loading,
    /** Null after loading means the peer has not written our key copy yet. */
    conversationKey,
    sendText,
    retry,
    discard,
    ping,
    loadOlder,
    exhausted,
  };
}
