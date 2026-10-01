'use client';

import { use, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSession } from '@/lib/store/session';
import { useThread } from '@/lib/hooks/useThread';
import { dayLabel, lastSeenLabel } from '@/lib/format';
import { Avatar } from '@/components/ui/Avatar';
import { Spinner } from '@/components/ui/Spinner';
import { MessageBubble, type Quote } from '@/components/chat/MessageBubble';
import { MessageMenu } from '@/components/chat/MessageMenu';
import { Composer, type ComposerContext } from '@/components/chat/Composer';
import { TypingDots } from '@/components/chat/TypingDots';
import { tickState } from '@/components/chat/Ticks';
import { ChatInfoSheet } from '@/components/chat/ChatInfoSheet';
import type { DecryptedMessage } from '@/lib/db/schema';

export default function ThreadPage({ params }: { params: Promise<{ chatId: string }> }) {
  const { chatId } = use(params);
  const { user } = useSession();
  const [infoOpen, setInfoOpen] = useState(false);
  const [menuFor, setMenuFor] = useState<DecryptedMessage | null>(null);
  const [composerContext, setComposerContext] = useState<ComposerContext>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);

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
    editText,
    deleteForEveryone,
    deleteForMe,
    retry,
    discard,
    notice,
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

  // The keyboard or emoji panel opening shrinks the list from below without
  // moving its scroll position, which would slide the newest messages out of
  // sight behind the composer. Stay pinned if the reader was at the bottom.
  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const observer = new ResizeObserver(() => {
      if (atBottom.current) node.scrollTo({ top: node.scrollHeight });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const groups = useMemo(() => groupByDay(messages), [messages]);
  const byId = useMemo(() => new Map(messages.map((message) => [message.id, message])), [messages]);

  const authorOf = (message: DecryptedMessage) =>
    message.senderId === user?.uid ? 'You' : (peer?.displayName ?? 'Them');

  // Quotes are rendered from plaintext already decrypted on this device; the
  // message itself stores only the id it replies to.
  function quoteFor(message: DecryptedMessage): Quote | null {
    if (!message.replyTo) return null;
    const original = byId.get(message.replyTo);
    if (!original) return { author: '', text: null, deleted: false };
    return { author: authorOf(original), text: original.text, deleted: original.deleted };
  }

  function replyTo(message: DecryptedMessage) {
    setComposerContext({
      kind: 'reply',
      id: message.id,
      author: authorOf(message),
      text: message.text,
    });
  }

  function jumpTo(id: string) {
    const node = document.getElementById(`m-${id}`);
    if (!node) return;
    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlighted(id);
    setTimeout(() => setHighlighted((current) => (current === id ? null : current)), 1200);
  }

  function handleSend(text: string) {
    const context = composerContext;
    setComposerContext(null);

    if (context?.kind === 'edit') {
      if (text !== context.text) editText(context.id, text);
      return;
    }
    atBottom.current = true;
    return sendText(text, context?.kind === 'reply' ? context.id : null);
  }

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
        // overflow-x-hidden: a bubble dragged for swipe-to-reply must not
        // widen the scroller.
        className="min-h-0 flex-1 space-y-1 overflow-x-hidden overflow-y-auto px-3 py-3 scroll-thin"
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
                    quote={quoteFor(message)}
                    highlighted={highlighted === message.id}
                    onReply={() => replyTo(message)}
                    onMenu={() => setMenuFor(message)}
                    onQuoteClick={() => message.replyTo && jumpTo(message.replyTo)}
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

      {notice && (
        <p role="status" className="bg-surface px-4 pt-2 text-center text-[13px] text-danger">
          {notice}
        </p>
      )}

      <Composer
        onSend={handleSend}
        onTyping={ping}
        disabled={!loading && !conversationKey}
        context={composerContext}
        onCancelContext={() => setComposerContext(null)}
      />

      {menuFor && (
        <MessageMenu
          message={menuFor}
          mine={menuFor.senderId === user?.uid}
          onReply={() => replyTo(menuFor)}
          onEdit={() =>
            menuFor.text !== null &&
            setComposerContext({ kind: 'edit', id: menuFor.id, text: menuFor.text })
          }
          onDelete={() => deleteForEveryone(menuFor.id)}
          onDeleteForMe={() => deleteForMe(menuFor.id)}
          onClose={() => setMenuFor(null)}
        />
      )}

      {infoOpen && peer && (
        <ChatInfoSheet peer={peer} presence={presence} onClose={() => setInfoOpen(false)} />
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
