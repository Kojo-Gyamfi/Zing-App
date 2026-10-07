'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useSession } from '@/lib/store/session';
import { useKeys } from '@/lib/store/keys';
import { useProfiles } from '@/lib/store/profiles';
import { useChats } from '@/lib/store/chats';
import {
  subscribeMessages,
  sendMessage as send,
  editMessage,
  deleteMessage,
  hideMessage,
  subscribeHidden,
  subscribeStarred,
  setStarred,
  setReaction,
  loadOlderMessages,
  PAGE_SIZE,
} from '@/lib/db/messages';
import { withReaction } from '@/lib/reactions';
import {
  clearUnread,
  markRead,
  onConversationKeyReady,
  subscribeChat,
  type ChatSummary,
} from '@/lib/db/chats';
import { useAccount, usePrivacy } from '@/lib/store/account';
import { setBlocked } from '@/lib/db/privacy';
import { needsReadReceipt } from '@/lib/receipts';
import { notifyPeers } from '@/lib/notify';
import { subscribePresence, subscribeTyping, setTyping, type Presence } from '@/lib/db/presence';
import type { DecryptedMessage, UserDoc } from '@/lib/db/schema';

const TYPING_THROTTLE = 2000;
const NO_IDS: ReadonlySet<string> = new Set();
const NO_PRESENCE: Presence = { online: false, lastSeen: null };

/**
 * Everything one conversation needs: the key, the decrypted messages, the
 * peer's profile, their presence and their typing state.
 */
export function useThread(chatId: string, peerUid: string | null) {
  const { user, identity } = useSession();
  const keyFor = useKeys((state) => state.get);
  const forgetMiss = useKeys((state) => state.forgetMiss);
  const loadProfile = useProfiles((state) => state.load);

  const [conversationKey, setConversationKey] = useState<Uint8Array | null>(null);
  const [messages, setMessages] = useState<DecryptedMessage[]>([]);
  const [older, setOlder] = useState<DecryptedMessage[]>([]);
  const [peer, setPeer] = useState<UserDoc | null>(null);
  const [presence, setPresence] = useState<Presence>({ online: false, lastSeen: null });
  const [peerTyping, setPeerTyping] = useState(false);
  const [loading, setLoading] = useState(true);
  const [exhausted, setExhausted] = useState(false);
  const markedRead = useRef<string | null>(null);
  const [failed, setFailed] = useState<(DecryptedMessage & { chatId: string })[]>([]);

  const lastTypingPing = useRef(0);
  const loadingOlder = useRef(false);
  const liveWindow = useRef<DecryptedMessage[]>([]);

  // "Delete for me". Tagged with the chat it belongs to so a stale set from the
  // previous chat never filters this one.
  const [hidden, setHidden] = useState<{ chatId: string; ids: Set<string> }>({
    chatId,
    ids: new Set(),
  });

  // A short-lived line above the composer for actions that fail after the fact.
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const flash = useCallback((text: string) => {
    setNotice(text);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 4000);
  }, []);

  useEffect(() => {
    if (!user || !identity) return;
    let live = true;
    let stopWatching: (() => void) | null = null;

    void keyFor(chatId, user.uid, identity).then((key) => {
      if (!live) return;
      if (key) {
        setConversationKey(key);
        return;
      }
      // Not written yet: the other person opened this chat a moment ago and
      // their app is still sealing our copy. Wait for it rather than sitting
      // on "Decrypting" until the chat is reopened.
      stopWatching = onConversationKeyReady(chatId, user.uid, () => {
        forgetMiss(chatId);
        void keyFor(chatId, user.uid, identity).then((ready) => {
          if (live && ready) {
            setConversationKey(ready);
            stopWatching?.();
            stopWatching = null;
          }
        });
      });
    });

    return () => {
      live = false;
      stopWatching?.();
    };
  }, [chatId, user, identity, keyFor, forgetMiss]);

  const peerDeleted = useProfiles((state) => (peerUid ? Boolean(state.missing[peerUid]) : false));
  const privacy = usePrivacy();

  useEffect(() => {
    if (!peerUid) return;
    // Fresh: the page checks this profile's public key for changes.
    void loadProfile(peerUid, { fresh: true }).then(setPeer);
  }, [peerUid, loadProfile]);


  useEffect(() => {
    if (!user) return;
    return subscribeHidden(chatId, user.uid, (ids) => setHidden({ chatId, ids }));
  }, [chatId, user]);

  // Starred, tagged with its chat like `hidden` above.
  const [starred, setStarredIds] = useState<{ chatId: string; ids: Set<string> }>({
    chatId,
    ids: new Set(),
  });
  useEffect(() => {
    if (!user) return;
    return subscribeStarred(chatId, user.uid, (ids) => setStarredIds({ chatId, ids }));
  }, [chatId, user]);

  // Receipts for the messages I sent, live while the thread is open. Taken
  // from the chat list's listener, which already has this doc: a second
  // listener here would pay for every receipt twice (lib/store/chats.ts).
  const uid = user?.uid;
  const listReady = useChats((state) => uid !== undefined && state.owner === uid);
  const listed = useChats((state) => (state.owner === uid ? state.chats[chatId] : undefined));
  const listedConfirmed = useChats((state) =>
    state.owner === uid ? state.confirmed[chatId] : undefined,
  );
  const inList = listed !== undefined;

  // Only for a chat the list does not hold -- older than its loaded pages, or
  // the list's listener refused -- does the thread listen for itself.
  const [direct, setDirect] = useState<{
    chatId: string;
    latest: ChatSummary | null;
    confirmed: ChatSummary | null | undefined;
  } | null>(null);
  useEffect(() => {
    if (!peerUid || !listReady || inList) return;
    return subscribeChat(chatId, (chat) =>
      setDirect((previous) => ({
        chatId,
        latest: chat,
        // Same rule as the store: a pending write's timestamps are this
        // device's clock, so keep the last confirmed copy instead.
        confirmed: chat?.pending
          ? previous?.chatId === chatId
            ? previous.confirmed
            : undefined
          : chat,
      })),
    );
  }, [chatId, peerUid, listReady, inList]);

  const ownDirect = !inList && direct?.chatId === chatId ? direct : null;
  const latest = inList ? listed : ownDirect?.latest;
  // undefined: not confirmed by the server yet. null: the chat does not exist.
  const confirmed = inList ? listedConfirmed : ownDirect?.confirmed;

  // Blocking, either way round. The rules refuse sends while either is set.
  const blockedByMe = Boolean(uid && latest?.blocked?.[uid]);
  const blockedByPeer = Boolean(peerUid && latest?.blocked?.[peerUid]);
  const blocked = blockedByMe || blockedByPeer;

  // No typing indicator across a block.
  useEffect(() => {
    if (!peerUid || blocked) return;
    return subscribeTyping(chatId, peerUid, setPeerTyping);
  }, [chatId, peerUid, blocked]);

  // Nor presence. And hiding my own last seen hides theirs from me too, as
  // on WhatsApp.
  const showPresence = privacy.lastSeen && !blocked;
  useEffect(() => {
    if (!peerUid || !showPresence) return;
    return subscribePresence(peerUid, setPresence);
  }, [peerUid, showPresence]);

  // As epoch ms, so a fresh snapshot of an unchanged receipt is not a "change"
  // to the effects below; memoised back into Dates on that number alone.
  const peerReadMs = peerUid ? (latest?.lastRead?.[peerUid]?.toDate?.()?.getTime() ?? null) : null;
  const peerDeliveredMs = peerUid
    ? (latest?.lastDelivered?.[peerUid]?.toDate?.()?.getTime() ?? null)
    : null;
  const myReadMs =
    !peerUid || !uid || confirmed === undefined
      ? undefined
      : (confirmed?.lastRead?.[uid]?.toDate?.()?.getTime() ?? null);
  // With my read receipts off I see none of theirs either, as on WhatsApp.
  const peerReadAt = useMemo(
    () => (privacy.readReceipts ? asDate(peerReadMs) : null),
    [peerReadMs, privacy.readReceipts],
  );
  const peerDeliveredAt = useMemo(() => asDate(peerDeliveredMs), [peerDeliveredMs]);
  // My own read receipt as the server has it -- undefined while unconfirmed.
  const myReadAt = useMemo(() => asDate(myReadMs), [myReadMs]);
  // My badge here as the server has it -- undefined while unconfirmed.
  const myUnread =
    !peerUid || !uid || confirmed === undefined ? undefined : (confirmed?.unread?.[uid] ?? 0);

  useEffect(() => {
    if (!conversationKey) return;

    const unsubscribe = subscribeMessages(
      chatId,
      conversationKey,
      (next) => {
        // The live window is the newest PAGE_SIZE; each new message pushes
        // the oldest one out. It is handed to the older list rather than
        // dropped: if history was already scrolled to its start, nothing
        // would ever fetch it back.
        const edge = next[0]?.createdAt?.getTime();
        const dropped =
          edge === undefined
            ? []
            : liveWindow.current.filter(
                (message) =>
                  message.createdAt &&
                  message.createdAt.getTime() <= edge &&
                  !next.some((entry) => entry.id === message.id),
              );
        liveWindow.current = next;
        if (dropped.length) {
          setOlder((current) => [...current, ...dropped]);
        }
        setMessages(next);
        setLoading(false);
      },
      // A refused listener would otherwise leave the thread on its spinner.
      () => setLoading(false),
    );

    return unsubscribe;
  }, [chatId, conversationKey]);

  // A read receipt only when there is something new from the other person:
  // not on every open, and not when I send. Each receipt is a write that every
  // open screen on both sides then re-reads. See lib/receipts.ts.
  const incoming = messages.findLast((message) => message.senderId !== user?.uid);
  const incomingId = incoming?.id;
  const incomingAt = incoming?.createdAt?.getTime();
  // A thread open in a background tab, or a backgrounded app, has not been
  // read: no blue ticks until the person can actually see it.
  const pageVisible = useSyncExternalStore(subscribeVisibility, isPageVisible, () => true);
  const sendReceipts = privacy.readReceipts;
  // Until the settings are read, "on" is only the default: wait rather than
  // send a receipt someone has turned off.
  const privacyKnown = useAccount((state) => state.known);
  useEffect(() => {
    if (!user || loading || !pageVisible || !privacyKnown || !incomingId || incomingAt === undefined) {
      return;
    }

    // Read receipts off: clear my badge, and never write lastRead.
    if (!sendReceipts) {
      if (!myUnread || markedRead.current === incomingId) return;
      markedRead.current = incomingId;
      void clearUnread(chatId, user.uid).catch(() => {
        markedRead.current = null;
      });
      return;
    }

    if (
      !needsReadReceipt({
        newestIncoming: { id: incomingId, createdAt: new Date(incomingAt) },
        readAt: myReadAt,
        marked: markedRead.current,
      })
    ) {
      return;
    }

    markedRead.current = incomingId;
    void markRead(chatId, user.uid).catch(() => {
      markedRead.current = null;
    });
  }, [
    chatId,
    user,
    loading,
    pageVisible,
    privacyKnown,
    myReadAt,
    myUnread,
    sendReceipts,
    incomingId,
    incomingAt,
  ]);

  const sendText = useCallback(
    async (text: string, replyTo: string | null = null, forwarded = false) => {
      if (!user || !conversationKey || !text.trim()) return;

      setTyping(chatId, user.uid, false);
      lastTypingPing.current = 0;

      const sentAt = new Date();
      const { id, envelope, committed } = await send({
        chatId,
        senderId: user.uid,
        text: text.trim(),
        conversationKey,
        replyTo,
        forwarded,
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
              replyTo,
              forwarded,
              edited: false,
              deleted: false,
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
      void sendText(message.text, message.replyTo, message.forwarded);
    },
    [failed, sendText],
  );

  const discard = useCallback((id: string) => {
    setFailed((current) => current.filter((entry) => entry.id !== id));
  }, []);

  // Older pages are fetched once, not live, so patch them by hand; the live
  // page picks the change up from its own listener.
  const patchOlder = useCallback((id: string, patch: Partial<DecryptedMessage>) => {
    setOlder((current) =>
      current.map((message) => (message.id === id ? { ...message, ...patch } : message)),
    );
  }, []);

  const isLatest = useCallback((id: string) => messages.at(-1)?.id === id, [messages]);

  // Neither awaits the commit: offline it would hang until reconnect, and the
  // local cache already shows the change. A refusal (say, the edit window
  // closed in the meantime) rolls it back and says why.
  const editText = useCallback(
    (id: string, text: string) => {
      if (!user || !conversationKey || !text.trim()) return;

      const before = older.find((message) => message.id === id);
      patchOlder(id, { text: text.trim(), edited: true });
      editMessage({
        chatId,
        messageId: id,
        senderId: user.uid,
        text: text.trim(),
        conversationKey,
        isLatest: isLatest(id),
      }).catch(() => {
        if (before) patchOlder(id, before);
        flash('That message can no longer be edited.');
      });
    },
    [chatId, user, conversationKey, older, isLatest, patchOlder, flash],
  );

  const deleteForEveryone = useCallback(
    (id: string) => {
      if (!user) return;

      const before = older.find((message) => message.id === id);
      patchOlder(id, { text: null, deleted: true, edited: false });
      deleteMessage({ chatId, messageId: id, senderId: user.uid, isLatest: isLatest(id) }).catch(
        () => {
          if (before) patchOlder(id, before);
          flash('Could not delete that message.');
        },
      );
    },
    [chatId, user, older, isLatest, patchOlder, flash],
  );

  const deleteForMe = useCallback(
    (id: string) => {
      if (!user) return;

      // Hide straight away; the listener confirms, and a refusal puts it back.
      setHidden((current) =>
        current.chatId === chatId ? { chatId, ids: new Set(current.ids).add(id) } : current,
      );
      hideMessage(chatId, user.uid, id).catch(() => {
        setHidden((current) => {
          const ids = new Set(current.ids);
          ids.delete(id);
          return { ...current, ids };
        });
        flash('Could not delete that message.');
      });
      // A message deleted for me should not live on under Starred.
      if (starred.chatId === chatId && starred.ids.has(id)) {
        void setStarred(chatId, user.uid, id, false).catch(() => undefined);
      }
    },
    [chatId, user, flash, starred],
  );

  /** React, change a reaction, or take it back (emoji null). */
  const react = useCallback(
    (id: string, emoji: string | null) => {
      if (!user || !conversationKey) return;

      // The live page shows it from the local cache at once; an older page is
      // static, so it is patched by hand like an edit.
      const before = older.find((message) => message.id === id);
      if (before) patchOlder(id, { reactions: withReaction(before.reactions, user.uid, emoji) });
      setReaction({ chatId, messageId: id, uid: user.uid, emoji, conversationKey }).catch(() => {
        if (before) patchOlder(id, before);
        flash('Could not react to that message.');
      });
    },
    [chatId, user, conversationKey, older, patchOlder, flash],
  );

  const toggleStar = useCallback(
    (id: string, on: boolean) => {
      if (!user) return;
      setStarred(chatId, user.uid, id, on).catch(() =>
        flash(on ? 'Could not star that message.' : 'Could not unstar that message.'),
      );
    },
    [chatId, user, flash],
  );

  /**
   * Forward plaintext into another chat: sealed afresh under that chat's own
   * key, so nothing is shared between the two conversations. False when that
   * chat's key cannot be had (it is still being set up).
   */
  const forward = useCallback(
    async (text: string, target: string): Promise<boolean> => {
      if (!user || !identity) return false;
      if (target === chatId) {
        await sendText(text, null, true);
        return true;
      }
      const key = await keyFor(target, user.uid, identity);
      if (!key) return false;
      const { envelope, committed } = await send({
        chatId: target,
        senderId: user.uid,
        text,
        conversationKey: key,
        forwarded: true,
      });
      committed.then(
        () => void notifyPeers(target, envelope),
        () => undefined,
      );
      return true;
    },
    [chatId, user, identity, keyFor, sendText],
  );

  /**
   * Block or unblock the other person. Not awaited: the local cache shows the
   * change at once, and offline the commit would wait for a reconnect.
   */
  const setBlock = useCallback(
    (on: boolean) => {
      if (!user || !peerUid) return;
      setBlocked(user.uid, chatId, peerUid, on).catch(() =>
        flash(on ? 'Could not block. Try again.' : 'Could not unblock. Try again.'),
      );
    },
    [chatId, user, peerUid, flash],
  );

  /** Throttled: one RTDB write every couple of seconds, not one per keystroke. */
  const ping = useCallback(() => {
    if (!user) return;
    const now = Date.now();
    if (now - lastTypingPing.current < TYPING_THROTTLE) return;

    lastTypingPing.current = now;
    setTyping(chatId, user.uid, true);
  }, [chatId, user]);

  const loadOlder = useCallback(async () => {
    // Every scroll event near the top calls this; without the guard each one
    // fetched the same page again and it was added several times over.
    if (!conversationKey || exhausted || loadingOlder.current) return;

    const oldest = (older[0] ?? messages[0])?.createdAt;
    if (!oldest) return;

    loadingOlder.current = true;
    try {
      const page = await loadOlderMessages(chatId, conversationKey, oldest);
      if (page.length < PAGE_SIZE) setExhausted(true);
      setOlder((current) => [...page, ...current]);
    } finally {
      loadingOlder.current = false;
    }
  }, [chatId, conversationKey, older, messages, exhausted]);

  // Clear typing if the tab goes away mid-sentence.
  useEffect(() => {
    return () => {
      if (user) setTyping(chatId, user.uid, false);
    };
  }, [chatId, user]);

  const hiddenIds = hidden.chatId === chatId ? hidden.ids : null;
  // An older page can overlap the live window at its edge (several messages
  // sharing a timestamp, or the window sliding as new ones arrive), so each
  // message appears once: the live copy wins, being the freshest.
  const liveIds = new Set(messages.map((message) => message.id));
  const seen = new Set<string>();
  const olderOnce = older.filter((message) => {
    if (liveIds.has(message.id) || seen.has(message.id)) return false;
    seen.add(message.id);
    return true;
  });
  const thread = [...olderOnce, ...messages].filter((message) => !hiddenIds?.has(message.id));
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
    /** The other person deleted their account: the thread is read-only. */
    peerDeleted,
    /** Read-only too, until whoever blocked unblocks. */
    blockedByMe,
    blockedByPeer,
    setBlock,
    presence: showPresence ? presence : NO_PRESENCE,
    peerTyping: peerTyping && !blocked,
    peerReadAt,
    peerDeliveredAt,
    loading,
    /** Null after loading means the peer has not written our key copy yet. */
    conversationKey,
    sendText,
    editText,
    deleteForEveryone,
    deleteForMe,
    react,
    starredIds: starred.chatId === chatId ? starred.ids : NO_IDS,
    toggleStar,
    forward,
    retry,
    discard,
    notice,
    ping,
    loadOlder,
    exhausted,
  };
}

function asDate<T extends null | undefined>(ms: number | T): Date | T {
  return typeof ms === 'number' ? new Date(ms) : ms;
}

function subscribeVisibility(onChange: () => void): () => void {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}

function isPageVisible(): boolean {
  return document.visibilityState === 'visible';
}
