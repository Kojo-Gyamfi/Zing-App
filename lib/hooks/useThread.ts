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
  hideMessages,
  clearChat as clearChatFor,
  subscribeHidden,
  subscribeStarred,
  setStarred,
  setReaction,
  loadOlderMessages,
  hasExpired,
  removeExpiredMessage,
  DELETE_SLACK_MS,
  PAGE_SIZE,
  markViewed,
  setPinnedMessage,
  loadMessagesById,
} from '@/lib/db/messages';
import { withReaction } from '@/lib/reactions';
import { isHidden, NOTHING_HIDDEN, type HiddenList } from '@/lib/hidden';
import {
  clearUnread,
  markRead,
  onConversationKeyReady,
  setDisappearing,
  subscribeChat,
  type ChatSummary,
} from '@/lib/db/chats';
import { useAccount, usePrivacy } from '@/lib/store/account';
import { setBlocked } from '@/lib/db/privacy';
import { needsReadReceipt } from '@/lib/receipts';
import { notifyPeers } from '@/lib/notify';
import { isSelfChat } from '@/lib/chatIds';
import { subscribePresence, subscribeTyping, setTyping, type Presence } from '@/lib/db/presence';
import type { DecryptedMessage, UserDoc } from '@/lib/db/schema';

const TYPING_THROTTLE = 2000;
const NO_IDS: ReadonlySet<string> = new Set();
const NO_PINS: string[] = [];
const MESSAGE_ID = /^[A-Za-z0-9]{1,40}$/;
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

  // "Delete for me" and "Clear chat". Tagged with the chat it belongs to so a
  // stale list from the previous chat never filters this one.
  const [hidden, setHidden] = useState<{ chatId: string; list: HiddenList }>({
    chatId,
    list: NOTHING_HIDDEN,
  });
  const clearedAt = hidden.chatId === chatId ? hidden.list.clearedAt : null;

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
    return subscribeHidden(chatId, user.uid, (list) => setHidden({ chatId, list }));
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
  // "Message yourself": nobody to type at, notify or show receipts to.
  const selfChat = isSelfChat(chatId, uid);
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
    if (!uid || !listReady || inList) return;
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
  }, [chatId, uid, listReady, inList]);

  const ownDirect = !inList && direct?.chatId === chatId ? direct : null;
  const latest = inList ? listed : ownDirect?.latest;
  // undefined: not confirmed by the server yet. null: the chat does not exist.
  const confirmed = inList ? listedConfirmed : ownDirect?.confirmed;

  // The disappearing-messages timer, in seconds; 0 is off.
  const disappearing = latest?.disappearing ?? 0;

  // Pinned message ids, oldest pin first. Only well-formed ids: one that is
  // not would make the fetch of the others fail.
  const pinnedRaw = latest?.pinnedMessages;
  const pinnedIds = useMemo(
    () => (Array.isArray(pinnedRaw) ? pinnedRaw.filter((id) => typeof id === 'string' && MESSAGE_ID.test(id)) : NO_PINS),
    [pinnedRaw],
  );

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
    async (text: string, replyTo: string | null = null, forwarded = false, viewOnce = false) => {
      if (!user || !conversationKey || !text.trim()) return;

      if (!selfChat) setTyping(chatId, user.uid, false);
      lastTypingPing.current = 0;

      const sentAt = new Date();
      const { id, envelope, committed } = await send({
        chatId,
        senderId: user.uid,
        text: text.trim(),
        conversationKey,
        replyTo,
        forwarded,
        disappearAfter: disappearing,
        // Nobody else in a chat with myself to see it once.
        viewOnce: viewOnce && !selfChat,
      });

      committed.then(
        // Push only once the server has the message, so nobody is buzzed for
        // one that never landed. Offline, this waits for the reconnect.
        () => {
          if (!selfChat) void notifyPeers(chatId, envelope, viewOnce);
        },
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
              viewOnce,
              edited: false,
              deleted: false,
              pending: false,
              failed: true,
            },
          ]),
      );
    },
    [chatId, user, conversationKey, disappearing, selfChat],
  );

  const retry = useCallback(
    (id: string) => {
      const message = failed.find((entry) => entry.id === id);
      if (!message?.text) return;

      setFailed((current) => current.filter((entry) => entry.id !== id));
      void sendText(message.text, message.replyTo, message.forwarded, message.viewOnce);
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
        expiresAt: (messages.find((message) => message.id === id) ?? before)?.expiresAt ?? null,
      }).catch(() => {
        if (before) patchOlder(id, before);
        flash('That message can no longer be edited.');
      });
    },
    [chatId, user, conversationKey, older, messages, isLatest, patchOlder, flash],
  );

  const deleteForEveryone = useCallback(
    (id: string) => {
      if (!user) return;

      const before = older.find((message) => message.id === id);
      patchOlder(id, { text: null, deleted: true, edited: false });
      deleteMessage({
        chatId,
        messageId: id,
        senderId: user.uid,
        isLatest: isLatest(id),
        pinned: pinnedIds.includes(id),
      }).catch(
        () => {
          if (before) patchOlder(id, before);
          flash('Could not delete that message.');
        },
      );
    },
    [chatId, user, older, isLatest, patchOlder, flash, pinnedIds],
  );

  /** "Delete for me", for one message or several (one write either way). */
  const deleteForMe = useCallback(
    (which: string | string[]) => {
      if (!user) return;
      const ids = Array.isArray(which) ? which : [which];
      if (ids.length === 0) return;

      // Hide straight away; the listener confirms, and a refusal puts them back.
      setHidden((current) => {
        if (current.chatId !== chatId) return current;
        const next = new Set(current.list.ids);
        ids.forEach((id) => next.add(id));
        return { chatId, list: { ...current.list, ids: next } };
      });
      hideMessages(chatId, user.uid, ids).catch(() => {
        setHidden((current) => {
          const next = new Set(current.list.ids);
          ids.forEach((id) => next.delete(id));
          return { ...current, list: { ...current.list, ids: next } };
        });
        flash(ids.length > 1 ? 'Could not delete those messages.' : 'Could not delete that message.');
      });
      // A message deleted for me should not live on under Starred.
      const starredHere = starred.chatId === chatId ? ids.filter((id) => starred.ids.has(id)) : [];
      if (starredHere.length) {
        void setStarred(chatId, user.uid, starredHere, false).catch(() => undefined);
      }
    },
    [chatId, user, flash, starred],
  );

  /**
   * "Clear chat" for me: everything so far goes, here and on my other devices.
   * Applied at once from this device's clock; the listener then brings the
   * server's time, which is what other devices use. A refusal puts it back.
   */
  const clearChat = useCallback(() => {
    if (!user) return;
    const before = hidden.chatId === chatId ? hidden.list : NOTHING_HIDDEN;
    setHidden({ chatId, list: { ids: new Set(), clearedAt: new Date() } });
    setOlder([]);
    setExhausted(false);
    clearChatFor(chatId, user.uid).catch(() => {
      setHidden({ chatId, list: before });
      flash('Could not clear this chat.');
    });
  }, [chatId, user, hidden, flash]);

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
    (id: string | string[], on: boolean) => {
      if (!user) return;
      setStarred(chatId, user.uid, id, on).catch(() =>
        flash(on ? 'Could not star that.' : 'Could not unstar that.'),
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
        // The target chat's own timer, from the list's copy of it.
        disappearAfter: useChats.getState().chats[target]?.disappearing ?? 0,
      });
      committed.then(
        () => {
          if (!isSelfChat(target, user.uid)) void notifyPeers(target, envelope);
        },
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

  const setTimer = useCallback(
    (seconds: number) => {
      setDisappearing(chatId, seconds).catch(() =>
        flash('Could not change disappearing messages. Try again.'),
      );
    },
    [chatId, flash],
  );

  /** Throttled: one RTDB write every couple of seconds, not one per keystroke. */
  const ping = useCallback(() => {
    if (!user || selfChat) return;
    const now = Date.now();
    if (now - lastTypingPing.current < TYPING_THROTTLE) return;

    lastTypingPing.current = now;
    setTyping(chatId, user.uid, true);
  }, [chatId, user, selfChat]);

  const loadOlder = useCallback(async () => {
    // Every scroll event near the top calls this; without the guard each one
    // fetched the same page again and it was added several times over.
    if (!conversationKey || exhausted || loadingOlder.current) return;

    const oldest = (older[0] ?? messages[0])?.createdAt;
    if (!oldest) return;

    loadingOlder.current = true;
    try {
      const page = await loadOlderMessages(chatId, conversationKey, oldest, clearedAt);
      // A short page from the offline cache only means nothing more is
      // cached; marking the chat "fully loaded" then would stick after the
      // connection returns.
      if (page.messages.length < PAGE_SIZE && !page.fromCache) setExhausted(true);
      setOlder((current) => [...page.messages, ...current]);
    } catch {
      // Offline with nothing cached, or refused: the next scroll tries again.
    } finally {
      loadingOlder.current = false;
    }
  }, [chatId, conversationKey, older, messages, exhausted, clearedAt]);

  // Clear typing if the tab goes away mid-sentence.
  useEffect(() => {
    return () => {
      if (user && !selfChat) setTyping(chatId, user.uid, false);
    };
  }, [chatId, user, selfChat]);

  // Disappearing messages leave the screen the moment they expire: a timer
  // for the next one due (re-armed at least hourly, since setTimeout cannot
  // wait 90 days), and the first device to notice deletes it for good.
  // Two moments matter per message: hiding it (its expiry, this clock) and
  // deleting it, DELETE_SLACK_MS later so a fast clock is not refused.
  const [now, setNow] = useState(() => Date.now());
  const nextExpiry = useMemo(() => {
    let next: number | null = null;
    for (const message of [...older, ...messages]) {
      const at = message.expiresAt?.getTime();
      if (at === undefined) continue;
      const due = at > now ? at : at + DELETE_SLACK_MS > now ? at + DELETE_SLACK_MS : null;
      if (due !== null && (next === null || due < next)) next = due;
    }
    return next;
  }, [older, messages, now]);
  useEffect(() => {
    if (nextExpiry === null) return;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.min(Math.max(nextExpiry - Date.now(), 0) + 50, 60 * 60 * 1000),
    );
    return () => clearTimeout(timer);
  }, [nextExpiry, now]);

  const removing = useRef(new Set<string>());
  useEffect(() => {
    for (const message of [...older, ...messages]) {
      if (
        message.pending ||
        !hasExpired(message, now - DELETE_SLACK_MS) ||
        removing.current.has(message.id)
      ) {
        continue;
      }
      // Tried once per session: refused only when this clock runs far ahead
      // of the server's, and then the sender's sweep will do.
      removing.current.add(message.id);
      void removeExpiredMessage(chatId, message.id).catch(() => undefined);
    }
  }, [chatId, older, messages, now]);

  const hiddenList = hidden.chatId === chatId ? hidden.list : NOTHING_HIDDEN;
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
  const thread = [...olderOnce, ...messages].filter(
    (message) => !isHidden(message, hiddenList) && !hasExpired(message, now),
  );

  // Pinned messages, oldest pin first. Rendered from the thread when loaded;
  // a pin older than the loaded pages is fetched by id, once (a read or three
  // when the pins change, not a listener).
  // Null for an id that was asked for and is not there (deleted outright).
  const [pinnedExtra, setPinnedExtra] = useState<{
    chatId: string;
    byId: Map<string, DecryptedMessage | null>;
  }>({
    chatId,
    byId: new Map(),
  });
  const loadedIds = new Set(thread.map((message) => message.id));
  const missingPins = pinnedIds.filter(
    (id) => !loadedIds.has(id) && !(pinnedExtra.chatId === chatId && pinnedExtra.byId.has(id)),
  );
  const missingKey = missingPins.join(' ');
  useEffect(() => {
    if (!conversationKey || !missingKey) return;
    let live = true;
    const wanted = missingKey.split(' ');
    void loadMessagesById(chatId, wanted, conversationKey)
      .then((found) => {
        if (!live) return;
        setPinnedExtra((current) => {
          const byId = new Map(current.chatId === chatId ? current.byId : []);
          wanted.forEach((id) => byId.set(id, null));
          found.forEach((message) => byId.set(message.id, message));
          return { chatId, byId };
        });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [chatId, conversationKey, missingKey]);

  const pinned = pinnedIds
    .map((id) =>
      thread.find((message) => message.id === id) ??
      (pinnedExtra.chatId === chatId ? pinnedExtra.byId.get(id) : undefined),
    )
    .filter(
      (message): message is DecryptedMessage =>
        message !== undefined &&
        message !== null &&
        !message.deleted &&
        !message.viewOnce &&
        !isHidden(message, hiddenList) &&
        !hasExpired(message, now),
    );

  const togglePin = (id: string, on: boolean) => {
    // Slots held by pins that show nothing any more -- deleted, expired, gone
    // -- are freed first, so pinning a fourth never pushes out a visible one.
    // Ones I merely hid stay: they are still the other person's pins.
    const gone = (pinId: string) => {
      const known =
        thread.find((message) => message.id === pinId) ??
        (pinnedExtra.chatId === chatId ? pinnedExtra.byId.get(pinId) : undefined);
      return known === null || (known !== undefined && (known.deleted || hasExpired(known, now)));
    };
    const current = pinnedIds.filter((pinId) => !gone(pinId));
    void setPinnedMessage(chatId, id, on, current).catch(() =>
      flash(on ? 'Could not pin that message.' : 'Could not unpin that message.'),
    );
  };

  /**
   * I opened a view-once message: its ciphertext goes from the server now.
   * The page keeps the text it already has on screen until it is closed.
   */
  const openViewOnce = (id: string) => {
    patchOlder(id, { viewed: true });
    void markViewed(chatId, id).catch(() => undefined);
  };
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
    /**
     * No such chat for this user (a mistyped or stale link, or someone else's
     * conversation): there is no key coming, so stop waiting for one.
     */
    unavailable: confirmed === null && !conversationKey,
    /** Read-only too, until whoever blocked unblocks. */
    blockedByMe,
    blockedByPeer,
    setBlock,
    /** Disappearing-messages timer in seconds, 0 when off. */
    disappearing,
    /**
     * The chat doc has been read. Until then the timer above is a guess of 0,
     * and a message sent in a disappearing chat would last forever.
     */
    chatKnown: latest !== undefined,
    setDisappearing: setTimer,
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
    clearChat,
    /** What I removed from this chat (deleted for me, or cleared). */
    hiddenList,
    openViewOnce,
    /** Pinned messages, oldest pin first, as this device can show them. */
    pinned,
    pinnedIds,
    togglePin,
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
