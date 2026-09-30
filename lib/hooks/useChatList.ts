'use client';

import { useEffect, useRef, useState } from 'react';
import { useSession } from '@/lib/store/session';
import { useKeys } from '@/lib/store/keys';
import { useProfiles } from '@/lib/store/profiles';
import { subscribeChats, markDelivered, type ChatSummary } from '@/lib/db/chats';
import { decryptPreview } from '@/lib/db/messages';
import { needsDeliveryReceipt } from '@/lib/receipts';
import type { UserDoc } from '@/lib/db/schema';

export type ChatListRow = {
  id: string;
  peer: UserDoc | null;
  /** Null when the preview cannot be decrypted yet; undefined-ish empty chats show a nudge. */
  preview: string | null;
  lastSenderId: string | null;
  updatedAt: Date | null;
  unread: boolean;
  /** Peer receipts, for rendering ticks on messages I sent. */
  peerReadAt: Date | null;
  peerDeliveredAt: Date | null;
};

/**
 * The chat list, decrypted.
 *
 * Every preview in this list is ciphertext in Firestore, so the list cannot
 * render until each conversation key has been unsealed. Keys and profiles are
 * both cached, so that cost lands once per session rather than once per
 * snapshot -- and snapshots arrive on every incoming message.
 */
export function useChatList() {
  const { user, identity } = useSession();
  const keyFor = useKeys((state) => state.get);
  const loadProfile = useProfiles((state) => state.load);

  const [rows, setRows] = useState<ChatListRow[]>([]);
  const [loading, setLoading] = useState(true);

  // chatId -> the updatedAt we already sent a delivery receipt for. See below.
  const acknowledged = useRef(new Map<string, number>());

  useEffect(() => {
    if (!user || !identity) return;

    let live = true;

    const unsubscribe = subscribeChats(user.uid, (chats: ChatSummary[]) => {
      void Promise.all(
        chats.map(async (chat): Promise<ChatListRow> => {
          const peerUid = chat.members.find((member) => member !== user.uid) ?? null;
          const [peer, key] = await Promise.all([
            peerUid ? loadProfile(peerUid) : Promise.resolve(null),
            keyFor(chat.id, user.uid, identity),
          ]);

          const updatedAt = chat.updatedAt?.toDate?.() ?? null;
          const readAt = chat.lastRead?.[user.uid]?.toDate?.() ?? null;
          const deliveredAt = chat.lastDelivered?.[user.uid]?.toDate?.() ?? null;

          // The second tick for the other side. The list stays subscribed for
          // as long as the app is open, so this fires even when the
          // conversation itself is closed -- which is exactly what delivered
          // is supposed to mean.
          // needsDeliveryReceipt carries the guards against a write loop.
          if (
            updatedAt !== null &&
            needsDeliveryReceipt({
              me: user.uid,
              pending: chat.pending,
              lastSenderId: chat.lastMessage?.senderId ?? null,
              updatedAt,
              deliveredAt,
              acknowledged: acknowledged.current.get(chat.id),
            })
          ) {
            acknowledged.current.set(chat.id, updatedAt.getTime());
            void markDelivered(chat.id, user.uid).catch(() => {
              // Let the next snapshot try again.
              acknowledged.current.delete(chat.id);
            });
          }

          return {
            id: chat.id,
            peer,
            preview: await decryptPreview(chat.lastMessage, key),
            lastSenderId: chat.lastMessage?.senderId ?? null,
            updatedAt,
            // Approximate but cheap: anything newer than my last open, that I
            // did not send myself.
            unread:
              chat.lastMessage !== null &&
              chat.lastMessage.senderId !== user.uid &&
              (readAt === null || (updatedAt !== null && updatedAt > readAt)),
            peerReadAt: peerUid ? (chat.lastRead?.[peerUid]?.toDate?.() ?? null) : null,
            peerDeliveredAt: peerUid ? (chat.lastDelivered?.[peerUid]?.toDate?.() ?? null) : null,
          };
        }),
      ).then((next) => {
        if (!live) return;
        setRows(next);
        setLoading(false);
      });
    });

    return () => {
      live = false;
      unsubscribe();
    };
  }, [user, identity, keyFor, loadProfile]);

  return { rows, loading };
}
