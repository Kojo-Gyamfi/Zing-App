'use client';

import { useMemo, useRef } from 'react';
import { motion, useMotionValue, useTransform } from 'motion/react';
import { bubbleTime } from '@/lib/format';
import { DELETED_LABEL } from '@/lib/db/messages';
import { splitMatches } from '@/lib/search';
import { firstLinkCard, splitLinks, type LinkCard } from '@/lib/links';
import type { ReactionChip } from '@/lib/reactions';
import { Ticks, type TickState } from './Ticks';
import type { DecryptedMessage } from '@/lib/db/schema';

/** How far a bubble must be dragged right before letting go counts as "reply". */
const SWIPE_TO_REPLY = 56;
const LONG_PRESS_MS = 450;

/** WhatsApp's marker for a message that was forwarded rather than typed. */
export function ForwardedLabel() {
  return (
    <span className="mb-0.5 flex items-center gap-1 text-[12px] text-muted italic">
      <svg viewBox="0 0 24 24" className="size-3.5" aria-hidden="true">
        <path
          d="M14 8l5 4-5 4M19 12h-9a5 5 0 0 0-5 5v1"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      Forwarded
    </span>
  );
}

const CARD_ICONS: Record<LinkCard['kind'], string> = {
  video: 'M4 6h16v12H4zM10 9.5v5l4.5-2.5z',
  code: 'M9 8l-4 4 4 4M15 8l4 4-4 4',
  map: 'M12 21s-6-5.6-6-10a6 6 0 0 1 12 0c0 4.4-6 10-6 10zM12 13a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
};

/**
 * The card under a message's first link, made from the URL alone -- no
 * request to the site, from either phone (see lib/links.ts). The host is the
 * real one, so a link whose text pretends to be somewhere else is caught out.
 */
function LinkPreview({ card }: { card: LinkCard }) {
  return (
    <a
      href={card.href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      referrerPolicy="no-referrer"
      onPointerDown={(event) => event.stopPropagation()}
      className="mt-1.5 flex items-center gap-2.5 rounded-lg bg-black/20 px-2.5 py-2 text-left"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-md bg-black/25 text-muted">
        <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
          <path
            d={CARD_ICONS[card.kind]}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium text-ink">{card.title}</span>
        <span className="block truncate text-[12px] text-muted">{card.host}</span>
      </span>
    </a>
  );
}

export type Quote = {
  author: string;
  /** Null when the quoted message is deleted, undecryptable, or not loaded. */
  text: string | null;
  deleted: boolean;
};

export function MessageBubble({
  message,
  mine,
  tick,
  tailed,
  quote,
  highlighted,
  reactions = [],
  starred = false,
  search = '',
  onReply,
  onMenu,
  onQuoteClick,
  onReactionClick,
  onRetry,
  onDiscard,
}: {
  message: DecryptedMessage;
  mine: boolean;
  tick: TickState;
  /** Last in a run from the same sender -- only that one gets the tail corner. */
  tailed: boolean;
  /** The message this one replies to, resolved from what is loaded locally. */
  quote?: Quote | null;
  /** Briefly true after jumping here from a quote or a search hit. */
  highlighted?: boolean;
  reactions?: ReactionChip[];
  starred?: boolean;
  /** The in-chat search query; matches in the text are marked. */
  search?: string;
  onReply?: () => void;
  onMenu?: () => void;
  onQuoteClick?: () => void;
  /** Tapping the reaction chips: takes mine back, if I reacted. */
  onReactionClick?: () => void;
  /** Only used for failed messages. */
  onRetry?: () => void;
  onDiscard?: () => void;
}) {
  const x = useMotionValue(0);
  // The reply arrow fades in as the bubble is pulled towards the threshold.
  const arrowOpacity = useTransform(x, [0, SWIPE_TO_REPLY], [0, 1]);
  const arrowScale = useTransform(x, [0, SWIPE_TO_REPLY], [0.6, 1]);

  // Long-press opens the action menu on touch; right-click does on desktop.
  // iOS Safari never fires contextmenu for a long-press, hence the timer.
  const pressTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pressStart = useRef<{ x: number; y: number } | null>(null);

  function cancelPress() {
    clearTimeout(pressTimer.current);
    pressStart.current = null;
  }

  // Swipe-to-reply needs something to quote; the menu only needs a real
  // message, so a "deleted" placeholder can still be deleted for me.
  const interactive = !message.failed && !message.deleted;
  const hasMenu = !message.failed;
  const showReactions = reactions.length > 0 && !message.deleted;
  const card = useMemo(() => (message.text ? firstLinkCard(message.text) : null), [message.text]);

  return (
    <motion.div
      id={`m-${message.id}`}
      // The "zing": messages arrive with a short flick rather than a fade.
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      className={`relative flex w-full rounded-xl transition-colors duration-700
        ${mine ? 'justify-end' : 'justify-start'}
        ${highlighted ? 'bg-zing/15' : ''}
        ${showReactions ? 'mb-4' : ''}`}
    >
      <motion.div
        drag={interactive ? 'x' : false}
        dragDirectionLock
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={{ left: 0, right: 0.6 }}
        dragSnapToOrigin
        style={{ x }}
        onDragStart={cancelPress}
        onDragEnd={(_, info) => {
          if (info.offset.x > SWIPE_TO_REPLY) onReply?.();
        }}
        onPointerDown={(event) => {
          if (!hasMenu || event.pointerType === 'mouse') return;
          pressStart.current = { x: event.clientX, y: event.clientY };
          pressTimer.current = setTimeout(() => {
            pressStart.current = null;
            navigator.vibrate?.(10);
            onMenu?.();
          }, LONG_PRESS_MS);
        }}
        onPointerMove={(event) => {
          const start = pressStart.current;
          if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) {
            cancelPress();
          }
        }}
        onPointerUp={cancelPress}
        onPointerCancel={cancelPress}
        onContextMenu={(event) => {
          if (!hasMenu) return;
          event.preventDefault();
          cancelPress();
          onMenu?.();
        }}
        // pan-y keeps vertical scrolling native while the bubble owns
        // horizontal drags; no-callout stops iOS's own long-press menu.
        className={`group relative max-w-[78%] touch-pan-y px-3 py-2 text-[15px] leading-snug
          select-none [-webkit-touch-callout:none] md:select-text
          ${mine ? 'bg-bubble-out text-ink' : 'bg-bubble-in text-ink'}
          ${
            mine
              ? `rounded-2xl ${tailed ? 'rounded-br-sm' : ''}`
              : `rounded-2xl ${tailed ? 'rounded-bl-sm' : ''}`
          }`}
      >
        {/* Rides along with the bubble, just off its left edge. */}
        {interactive && (
          <motion.span
            aria-hidden="true"
            style={{ opacity: arrowOpacity, scale: arrowScale }}
            className="pointer-events-none absolute top-1/2 right-full mr-2 grid size-8 -translate-y-1/2
              place-items-center rounded-full bg-elevated text-muted"
          >
            <svg viewBox="0 0 24 24" className="size-4">
              <path
                d="M10 8 5 12l5 4M5 12h9a5 5 0 0 1 5 5v1"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </motion.span>
        )}

        {message.forwarded && <ForwardedLabel />}

        {quote && (
          <button
            type="button"
            onClick={onQuoteClick}
            className="mb-1.5 block w-full rounded-lg border-l-[3px] border-zing bg-black/20
              px-2.5 py-1.5 text-left"
          >
            {quote.author && (
              <span className="block text-[12px] font-semibold text-zing">{quote.author}</span>
            )}
            <span className="line-clamp-2 text-[13px] text-muted">
              {quote.deleted ? (
                <em>{DELETED_LABEL}</em>
              ) : (
                (quote.text ?? <em>Original message not loaded</em>)
              )}
            </span>
          </button>
        )}

        {message.deleted ? (
          <span className="flex items-center gap-1.5 text-muted italic">
            <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden="true">
              <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.4" />
              <path d="M4 12 12 4" stroke="currentColor" strokeWidth="1.4" />
            </svg>
            {mine ? 'You deleted this message' : DELETED_LABEL}
          </span>
        ) : message.text === null ? (
          <span className="flex items-center gap-1.5 text-muted italic">
            <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden="true">
              <path
                d="M4 7V5a4 4 0 0 1 8 0v2m-9 0h10v7H3z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
              />
            </svg>
            Can&apos;t be decrypted on this device
          </span>
        ) : (
          <>
            <span className="break-words whitespace-pre-wrap">
              {search
                ? splitMatches(message.text, search).map((run, index) =>
                    run.match ? (
                      <mark key={index} className="rounded-sm bg-zing/40 text-ink">
                        {run.text}
                      </mark>
                    ) : (
                      run.text
                    ),
                  )
                : splitLinks(message.text).map((run, index) =>
                    run.href ? (
                      <a
                        key={index}
                        href={run.href}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        referrerPolicy="no-referrer"
                        // A tap on a link is not the start of a long-press.
                        onPointerDown={(event) => event.stopPropagation()}
                        className="break-all text-zing-soft underline underline-offset-2"
                      >
                        {run.text}
                      </a>
                    ) : (
                      run.text
                    ),
                  )}
            </span>
            {card && <LinkPreview card={card} />}
          </>
        )}

        {message.failed ? (
          <span className="mt-1 flex items-center justify-end gap-3 text-[12px]">
            <span className="text-danger">Not sent</span>
            <button onClick={onRetry} className="font-medium text-zing">
              Retry
            </button>
            <button onClick={onDiscard} className="text-muted">
              Delete
            </button>
          </span>
        ) : (
          <span className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-muted">
            {starred && (
              <svg viewBox="0 0 24 24" className="size-3" role="img" aria-label="Starred">
                <path
                  d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"
                  fill="currentColor"
                />
              </svg>
            )}
            {message.edited && <span>Edited</span>}
            {bubbleTime(message.createdAt)}
            {mine && !message.deleted && <Ticks state={tick} />}
          </span>
        )}

        {/* Desktop: right-click is not discoverable, so hovering a bubble shows
            an arrow that opens the same menu, as on WhatsApp Web. Touch keeps
            long-press -- there is no hover to reveal it. */}
        {hasMenu && (
          <button
            type="button"
            onClick={onMenu}
            onPointerDown={(event) => event.stopPropagation()}
            aria-label="Message options"
            // A fade in the bubble's own colour, so the text it sits over
            // melts away under the arrow instead of showing through it.
            className={`absolute top-0.5 right-0.5 hidden h-7 w-11 items-center justify-end rounded-tr-2xl
              bg-linear-to-l from-55% to-transparent pr-1.5 text-muted opacity-0 transition-opacity
              group-hover:opacity-100 hover:text-ink focus-visible:opacity-100 md:flex
              ${mine ? 'from-bubble-out' : 'from-bubble-in'}`}
          >
            <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
              <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}

        {/* Hangs off the bottom edge, WhatsApp style. */}
        {showReactions && (
          <button
            type="button"
            onClick={onReactionClick}
            aria-label={`Reactions: ${reactions
              .map((chip) => `${chip.emoji} ${chip.count}${chip.mine ? ', including yours' : ''}`)
              .join('; ')}`}
            className={`absolute -bottom-4 flex h-6 items-center gap-0.5 rounded-full border border-void
              bg-elevated px-1.5 text-[13px] leading-none shadow-sm shadow-black/40
              ${mine ? 'right-2' : 'left-2'}`}
          >
            {reactions.map((chip) => (
              <span key={chip.emoji}>{chip.emoji}</span>
            ))}
            {reactions.reduce((total, chip) => total + chip.count, 0) > 1 && (
              <span className="ml-0.5 text-[11px] text-muted">
                {reactions.reduce((total, chip) => total + chip.count, 0)}
              </span>
            )}
          </button>
        )}
      </motion.div>
    </motion.div>
  );
}
