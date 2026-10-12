'use client';

import { useEffect } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { takeOutbox, type QueuedReply } from '@/lib/crypto/vault';
import { sendMessage } from '@/lib/db/messages';
import { clearUnread, markRead } from '@/lib/db/chats';
import { notifyPeers } from '@/lib/notify';
import { isSelfChat } from '@/lib/chatIds';
import { useAccount } from '@/lib/store/account';
import { useKeys } from '@/lib/store/keys';
import { useSession } from '@/lib/store/session';
import type { ChatDoc } from '@/lib/db/schema';
import type { Identity } from '@/lib/crypto/types';

/**
 * Sends replies typed into notifications. The service worker only queues
 * them on this device (lib/crypto/vault.ts takeOutbox) -- it never signs in
 * or touches the database -- and nudges an open tab, or opens the chat. Here
 * each one is sealed under its chat's key and sent like any other message,
 * so it is end-to-end encrypted the same way.
 */
export function OutboxSender() {
  const status = useSession((state) => state.status);
  const uid = useSession((state) => state.user?.uid);
  const identity = useSession((state) => state.identity);

  useEffect(() => {
    if (status !== 'ready' || !uid || !identity) return;
    let running = false;
    const drain = async () => {
      if (running) return;
      running = true;
      try {
        const replies = await takeOutbox().catch(() => [] as QueuedReply[]);
        for (const reply of replies) await send(reply, uid, identity).catch(() => undefined);
      } finally {
        running = false;
      }
    };
    void drain();
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'zing-outbox') void drain();
    };
    navigator.serviceWorker?.addEventListener('message', onMessage);
    return () => navigator.serviceWorker?.removeEventListener('message', onMessage);
  }, [status, uid, identity]);

  return null;
}

async function send(reply: QueuedReply, uid: string, identity: Identity) {
  // Only into a chat this account is in: the queue is per device, and
  // another account may have been signed in when it was written.
  if (!reply.chatId.split('_').includes(uid) || !reply.text.trim()) return;
  const key = await useKeys.getState().get(reply.chatId, uid, identity);
  if (!key) return;

  // The chat's own timer, so a disappearing chat's reply disappears too.
  const chat = (await getDoc(doc(db(), 'chats', reply.chatId))).data() as ChatDoc | undefined;
  if (!chat || Object.keys(chat.blocked ?? {}).length > 0) return;

  const { envelope, committed } = await sendMessage({
    chatId: reply.chatId,
    senderId: uid,
    text: reply.text.trim(),
    conversationKey: key,
    disappearAfter: chat.disappearing ?? 0,
  });
  await committed;
  if (!isSelfChat(reply.chatId, uid)) void notifyPeers(reply.chatId, envelope);

  // Replying means having read it -- with a receipt only if I share those.
  const shareReceipts = useAccount.getState().settings.privacy.readReceipts;
  await (shareReceipts ? markRead(reply.chatId, uid) : clearUnread(reply.chatId, uid)).catch(
    () => undefined,
  );
}
