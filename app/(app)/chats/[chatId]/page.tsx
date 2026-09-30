'use client';

import { use, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSession } from '@/lib/store/session';
import { useThread } from '@/lib/hooks/useThread';
import { dayLabel, lastSeenLabel } from '@/lib/format';
import { Avatar } from '@/components/ui/Avatar';
import { Spinner } from '@/components/ui/Spinner';
import { MessageBubble } from '@/components/chat/MessageBubble';
import { Composer } from '@/components/chat/Composer';
import { TypingDots } from '@/components/chat/TypingDots';
import { tickState } from '@/components/chat/Ticks';
import { ChatInfoSheet } from '@/components/chat/ChatInfoSheet';
import type { DecryptedMessage } from '@/lib/db/schema';

export default function ThreadPage({ params }: { params: Promise<{ chatId: string }> }) {
  const { chatId } = use(params);
  const { user, identity } = useSession();
  const [infoOpen, setInfoOpen] = useState(false);

  // Direct chat ids are the two uids sorted and joined, so the peer is
  // derivable without a lookup.
  const peerUid = useMemo(
    () => chatId.split('_').find((uid) => uid !== user?.uid) ?? null,
    [chatId, user],
  );

  const {
    messages,
    peer,
    presence,
    peerTyping,
    loading,
    conversationKey,
    sendText,
    retry,
    discard,
    ping,
    loadOlder,
    exhausted,
    peerReadAt,
    peerDeliveredAt,
  } = useThread(chatId, peerUid);

  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);

  // Follow new messages only when the reader is already at the bottom --
  // yanking someone out of history they are scrolled up reading is worse than
  // missing an autoscroll.
  useEffect(() => {
    if (!atBottom.current) return;
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages.length, peerTyping]);

  const groups = useMemo(() => groupByDay(messages), [messages]);

  return (
    <div className="flex h-dvh flex-col bg-void">
      <header className="flex items-center gap-3 border-b border-line bg-surface px-2 pt-safe">
        <Link
          href="/chats"
          aria-label="Back"
          className="grid size-10 place-items-center rounded-full text-muted
            transition-colors hover:bg-elevated md:hidden"
        >
          <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
            <path
              d="M15 5 8 12l7 7"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Link>

        <button
          onClick={() => setInfoOpen(true)}
          className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-1 text-left"
        >
          <Avatar
            name={peer?.displayName ?? '?'}
            photoURL={peer?.photoURL}
            size={40}
            online={presence.online}
          />
          <div className="min-w-0">
            <p className="truncate font-semibold">{peer?.displayName ?? 'Loading'}</p>
            <p className="flex items-center gap-1.5 truncate text-[12px] text-muted">
              {peerTyping ? (
                <>
                  <TypingDots />
                  <span className="text-zing">typing</span>
                </>
              ) : (
                lastSeenLabel(presence)
              )}
            </p>
          </div>
        </button>
      </header>

      <div
        ref={scroller}
        onScroll={(event) => {
          const node = event.currentTarget;
          atBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
          if (node.scrollTop < 120 && !exhausted) void loadOlder();
        }}
        className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-3 scroll-thin"
      >
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-muted">
            <Spinner />
            <span className="text-sm">Decrypting</span>
          </div>
        ) : messages.length === 0 ? (
          <FirstMessageHint name={peer?.displayName ?? 'them'} />
        ) : (
          groups.map((group) => (
            <section key={group.label} className="space-y-1">
              <div className="sticky top-0 z-10 flex justify-center py-2">
                <span className="rounded-full bg-elevated/90 px-3 py-1 text-[11px] text-muted backdrop-blur">
                  {group.label}
                </span>
              </div>

              {group.messages.map((message, index) => {
                const mine = message.senderId === user?.uid;
                const next = group.messages[index + 1];

                return (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    mine={mine}
                    tailed={!next || next.senderId !== message.senderId}
                    onRetry={() => retry(message.id)}
                    onDiscard={() => discard(message.id)}
                    tick={tickState({
                      pending: message.pending,
                      createdAt: message.createdAt,
                      peerDeliveredAt,
                      peerReadAt,
                    })}
                  />
                );
              })}
            </section>
          ))
        )}
      </div>

      <Composer onSend={sendText} onTyping={ping} disabled={!loading && !conversationKey} />

      {infoOpen && peer && identity && (
        <ChatInfoSheet peer={peer} identity={identity} onClose={() => setInfoOpen(false)} />
      )}
    </div>
  );
}

function FirstMessageHint({ name }: { name: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-10 py-16 text-center">
      <svg viewBox="0 0 24 24" className="size-8 text-zing/60" aria-hidden="true">
        <path
          d="M6 10V7a6 6 0 0 1 12 0v3m-14 0h16v11H4z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        />
      </svg>
      <p className="text-[14px] text-muted">This is the start of your chat with {name}.</p>
      <p className="text-[12px] leading-relaxed text-faint">
        Messages here are encrypted on your device with a key only the two of you hold.
      </p>
    </div>
  );
}

function groupByDay(messages: DecryptedMessage[]) {
  const groups: { label: string; messages: DecryptedMessage[] }[] = [];

  for (const message of messages) {
    const label = message.createdAt ? dayLabel(message.createdAt) : 'Today';
    const current = groups.at(-1);

    if (current?.label === label) current.messages.push(message);
    else groups.push({ label, messages: [message] });
  }

  return groups;
}
