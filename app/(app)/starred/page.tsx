'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from '@/lib/store/session';
import { useKeys } from '@/lib/store/keys';
import { useProfiles } from '@/lib/store/profiles';
import { loadStarredMessages, setStarred, DELETED_LABEL, type StarredMessage } from '@/lib/db/messages';
import { listTime } from '@/lib/format';
import { Avatar } from '@/components/ui/Avatar';
import { Spinner } from '@/components/ui/Spinner';
import { FormattedText, ForwardedLabel } from '@/components/chat/MessageBubble';
import type { UserDoc } from '@/lib/db/schema';

/**
 * Every message this person starred, across all chats, decrypted on this
 * device. Firestore holds only which ids are starred; the words exist here.
 */
export default function StarredPage() {
  const { user, identity } = useSession();
  const keyFor = useKeys((state) => state.get);
  const loadProfile = useProfiles((state) => state.load);
  const [items, setItems] = useState<StarredMessage[] | null>(null);
  const [peers, setPeers] = useState<Record<string, UserDoc | null>>({});
  const [failed, setFailed] = useState(false);

  const uid = user?.uid;

  useEffect(() => {
    if (!uid || !identity) return;
    let live = true;

    loadStarredMessages(uid, (chatId) => keyFor(chatId, uid, identity))
      .then(async (messages) => {
        // The other person in each chat, for the "Kwame" / "You" labels.
        const peerUids = [
          ...new Set(messages.map((message) => message.chatId.split('_').find((id) => id !== uid) ?? '')),
        ].filter(Boolean);
        const profiles = await Promise.all(peerUids.map((peer) => loadProfile(peer)));
        if (!live) return;
        setPeers(Object.fromEntries(peerUids.map((peer, index) => [peer, profiles[index]])));
        setItems(messages);
      })
      .catch(() => live && setFailed(true));

    return () => {
      live = false;
    };
  }, [uid, identity, keyFor, loadProfile]);

  function unstar(message: StarredMessage) {
    if (!uid) return;
    setItems((current) => current?.filter((entry) => entry !== message) ?? null);
    setStarred(message.chatId, uid, message.id, false).catch(() =>
      // Put it back where it was: the list is newest first.
      setItems((current) =>
        [...(current ?? []), message].sort(
          (a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0),
        ),
      ),
    );
  }

  return (
    <div className="flex h-dvh flex-col bg-void">
      <header className="flex items-center gap-2 border-b border-line bg-surface px-2 pt-safe">
        <Link
          href="/chats"
          aria-label="Back"
          className="grid size-10 place-items-center rounded-full text-muted transition-colors hover:bg-elevated"
        >
          <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
            <path d="M15 5 8 12l7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
        <h1 className="py-4 text-[17px] font-semibold">Starred messages</h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        {failed ? (
          <p className="px-8 py-16 text-center text-[14px] text-muted">
            Could not load your starred messages. Check your connection and try again.
          </p>
        ) : items === null ? (
          <div className="flex items-center justify-center gap-2 py-16 text-muted">
            <Spinner />
            <span className="text-sm">Decrypting</span>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-10 py-16 text-center">
            <p className="text-[15px] text-muted">No starred messages.</p>
            <p className="text-[13px] leading-relaxed text-faint">
              Long-press a message and tap Star to keep it here.
            </p>
          </div>
        ) : (
          <ul className="mx-auto max-w-2xl divide-y divide-line">
            {items.map((message) => {
              const peerUid = message.chatId.split('_').find((id) => id !== uid) ?? '';
              const peer = peers[peerUid];
              const mine = message.senderId === uid;
              const peerName = peer?.displayName ?? 'Deleted account';

              return (
                <li key={`${message.chatId}:${message.id}`} className="flex gap-3 px-4 py-3">
                  <Avatar name={peerName} photoURL={peer?.photoURL} size={36} />
                  <Link href={`/chats/${message.chatId}#m-${message.id}`} className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[13px] font-medium">
                        {mine ? `You ▸ ${peerName}` : `${peerName} ▸ You`}
                      </span>
                      <span className="shrink-0 text-[12px] text-faint">{listTime(message.createdAt)}</span>
                    </span>
                    <span
                      className={`mt-1 inline-block max-w-full rounded-2xl px-3 py-2 text-[15px] leading-snug
                        break-words whitespace-pre-wrap ${mine ? 'bg-bubble-out' : 'bg-bubble-in'}`}
                    >
                      {message.forwarded && <ForwardedLabel />}
                      {message.deleted ? (
                        <em className="text-muted">{DELETED_LABEL}</em>
                      ) : message.text === null ? (
                        <em className="text-muted">Can&apos;t be decrypted on this device</em>
                      ) : (
                        <FormattedText text={message.text} />
                      )}
                    </span>
                  </Link>
                  <button
                    onClick={() => unstar(message)}
                    aria-label="Unstar"
                    className="grid size-9 shrink-0 place-items-center self-center rounded-full text-zing transition-colors hover:bg-elevated"
                  >
                    <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
                      <path
                        d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"
                        fill="currentColor"
                      />
                    </svg>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
