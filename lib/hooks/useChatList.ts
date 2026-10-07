'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from '@/lib/store/session';
import { useKeys } from '@/lib/store/keys';
import { useProfiles } from '@/lib/store/profiles';
import { useChats } from '@/lib/store/chats';
import { subscribeChats, markDelivered, CHAT_PAGE_SIZE, type ChatSummary } from '@/lib/db/chats';
import {
  clearExpiredPreview,
  decryptPreview,
  latestVisibleMessage,
  subscribeAllHidden,
  sweepExpiredMessages,
  DELETED_LABEL,
} from '@/lib/db/messages';
import { isUnread, needsDeliveryReceipt } from '@/lib/receipts';
import type { UserDoc } from '@/lib/db/schema';

export type ChatListRow = {
  id: string;
  peer: UserDoc | null;
  /** Confirmed gone (not merely unreadable offline): shown as "Deleted account". */
  peerDeleted: boolean;
  /** Null when the preview cannot be decrypted yet; undefined-ish empty chats show a nudge. */
  preview: string | null;
  lastSenderId: string | null;
  updatedAt: Date | null;
  unread: boolean;
  /** Messages not yet opened; at least 1 whenever `unread` is true. */
  unreadCount: number;
  /** Peer receipts, for rendering ticks on messages I sent. */
  peerReadAt: Date | null;
  peerDeliveredAt: Date | null;
};

const NO_HIDDEN = new Set<string>();

/**
 * The chat list, decrypted.
 *
 * Every preview in this list is ciphertext in Firestore, so the list cannot
 * render until each conversation key has been unsealed. Keys and profiles are
 * both cached, so that cost lands once per session rather than once per
 * snapshot -- and snapshots arrive on every incoming message.
 *
 * Paged: the newest CHAT_PAGE_SIZE chats, growing by a page per loadMore().
 */
export function useChatList() {
  const { user, identity } = useSession();
  const keyFor = useKeys((state) => state.get);
  const loadProfile = useProfiles((state) => state.load);
  const publishChats = useChats((state) => state.publish);
  const resetChats = useChats((state) => state.reset);

  const [rows, setRows] = useState<ChatListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [max, setMax] = useState(CHAT_PAGE_SIZE);
  const [hasMore, setHasMore] = useState(false);

  // The two live inputs. Rows are rebuilt whenever either changes.
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const [hidden, setHidden] = useState<Map<string, Set<string>>>(new Map());

  // chatId -> the updatedAt we already sent a delivery receipt for. See below.
  const acknowledged = useRef(new Map<string, number>());
  // Fallback previews for chats whose newest message I hid, keyed by
  // chat + hidden message + list size, so each is fetched once.
  const fallbackPreviews = useRef(new Map<string, string>());
  // Snapshots decrypt asynchronously; only the newest build may land.
  const build = useRef(0);
  const [retry, setRetry] = useState(0);

  const uid = user?.uid;

  useEffect(() => {
    if (!uid || !identity) return;
    return subscribeChats(
      uid,
      max,
      (next, more) => {
        setChats(next);
        setHasMore(more);
        // The open thread reads its receipts from these. See lib/store/chats.ts.
        publishChats(uid, next);
      },
      // Refused or failed: show what we have (or the empty state), not a
      // spinner forever. Publishing nothing sends the thread to its own
      // listener rather than leaving it waiting on this one.
      () => {
        setLoading(false);
        publishChats(uid, []);
      },
    );
  }, [uid, identity, max, publishChats]);

  // Not on every resubscribe (loadMore raises max): only when the account
  // changes or the list goes away, so the thread's ticks do not blink.
  useEffect(() => {
    if (!uid) return;
    return () => resetChats();
  }, [uid, resetChats]);

  useEffect(() => {
    if (!uid) return;
    return subscribeAllHidden(uid, setHidden);
  }, [uid]);

  // My own expired disappearing messages, wherever they are, once a session.
  // With no TTL on the free plan this is what clears chats nobody reopens.
  const swept = useRef<string | null>(null);
  useEffect(() => {
    if (!uid || swept.current === uid) return;
    swept.current = uid;
    void sweepExpiredMessages(uid).catch(() => undefined);
  }, [uid]);

  // Expired previews whose ciphertext is still on the chat doc, already
  // asked to be stripped this session.
  const clearedPreviews = useRef(new Set<string>());

  useEffect(() => {
    if (!uid || !identity || !chats) return;
    const current = ++build.current;
    let missingKey = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    void Promise.all(
      chats.map(async (chat): Promise<ChatListRow> => {
        const peerUid = chat.members.find((member) => member !== uid) ?? null;
        const [peer, key] = await Promise.all([
          peerUid ? loadProfile(peerUid) : Promise.resolve(null),
          keyFor(chat.id, uid, identity),
        ]);
        if (!key) missingKey = true;

        const updatedAt = chat.updatedAt?.toDate?.() ?? null;
        const readAt = chat.lastRead?.[uid]?.toDate?.() ?? null;
        const deliveredAt = chat.lastDelivered?.[uid]?.toDate?.() ?? null;

        // The second tick for the other side. The list stays subscribed for
        // as long as the app is open, so this fires even when the
        // conversation itself is closed -- which is exactly what delivered
        // is supposed to mean.
        // needsDeliveryReceipt carries the guards against a write loop.
        if (
          updatedAt !== null &&
          needsDeliveryReceipt({
            me: uid,
            pending: chat.pending,
            lastSenderId: chat.lastMessage?.senderId ?? null,
            updatedAt,
            deliveredAt,
            acknowledged: acknowledged.current.get(chat.id),
          })
        ) {
          acknowledged.current.set(chat.id, updatedAt.getTime());
          void markDelivered(chat.id, uid).catch(() => {
            // Let the next snapshot try again.
            acknowledged.current.delete(chat.id);
          });
        }

        // A disappearing preview past its time loses its ciphertext. Either
        // member may do it; once per message per session.
        const last = chat.lastMessage;
        if (
          last?.ciphertext &&
          last.expiresAt &&
          last.expiresAt.toMillis() <= Date.now() &&
          !chat.pending &&
          !clearedPreviews.current.has(`${chat.id}:${last.id}`)
        ) {
          clearedPreviews.current.add(`${chat.id}:${last.id}`);
          void clearExpiredPreview(chat.id, last).catch(() => undefined);
        }

        const count = chat.unread?.[uid];
        const unread = isUnread({
          me: uid,
          lastSenderId: chat.lastMessage?.senderId ?? null,
          count,
          updatedAt,
          readAt,
        });

        return {
          id: chat.id,
          peer,
          peerDeleted: peerUid ? Boolean(useProfiles.getState().missing[peerUid]) : false,
          preview: await previewFor(chat, key, hidden.get(chat.id) ?? NO_HIDDEN),
          lastSenderId: chat.lastMessage?.senderId ?? null,
          updatedAt,
          unread,
          // Chats from before the counter existed have none: show 1, not 0.
          unreadCount: unread ? Math.max(count ?? 0, 1) : 0,
          peerReadAt: peerUid ? (chat.lastRead?.[peerUid]?.toDate?.() ?? null) : null,
          peerDeliveredAt: peerUid ? (chat.lastDelivered?.[peerUid]?.toDate?.() ?? null) : null,
        };
      }),
    ).then((next) => {
      if (current !== build.current) return;
      setRows(next);
      setLoading(false);
      // A chat whose key the other side was still writing: look again once
      // the key cache's short miss window has passed.
      // A few times only: a key that never arrives must not cost a read forever.
      if (missingKey && retry < 6) {
        retryTimer = setTimeout(() => setRetry((value) => value + 1), 5500);
      }
    });

    /**
     * The newest message's preview, unless I deleted it for me -- then the
     * newest one I did not hide, fetched once and remembered.
     */
    async function previewFor(chat: ChatSummary, key: Uint8Array | null, hiddenIds: Set<string>) {
      const newestId = chat.lastMessage?.id;
      if (!newestId || !hiddenIds.has(newestId)) return decryptPreview(chat.lastMessage, key);

      const cacheKey = `${chat.id}:${newestId}:${hiddenIds.size}`;
      const cached = fallbackPreviews.current.get(cacheKey);
      if (cached !== undefined) return cached;

      const visible = await latestVisibleMessage(chat.id, key, hiddenIds).catch(() => null);
      const text = visible ? (visible.deleted ? DELETED_LABEL : (visible.text ?? '')) : '';
      fallbackPreviews.current.set(cacheKey, text);
      return text;
    }

    return () => {
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [uid, identity, chats, hidden, retry, keyFor, loadProfile]);

  // Scroll events fire many times before the bigger page arrives; grow only
  // once the current page has actually filled.
  const loaded = chats?.length ?? 0;
  const loadMore = useCallback(() => {
    if (hasMore && loaded >= max) setMax(max + CHAT_PAGE_SIZE);
  }, [hasMore, loaded, max]);

  return { rows, loading, hasMore, loadMore };
}
