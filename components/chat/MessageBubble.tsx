'use client';

import { useRef } from 'react';
import { motion, useMotionValue, useTransform } from 'motion/react';
import { bubbleTime } from '@/lib/format';
import { DELETED_LABEL } from '@/lib/db/messages';
import { Ticks, type TickState } from './Ticks';
import type { DecryptedMessage } from '@/lib/db/schema';

/** How far a bubble must be dragged right before letting go counts as "reply". */
const SWIPE_TO_REPLY = 56;
const LONG_PRESS_MS = 450;

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
  onReply,
  onMenu,
  onQuoteClick,
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
  /** Briefly true after jumping here from a quote. */
  highlighted?: boolean;
  onReply?: () => void;
  onMenu?: () => void;
  onQuoteClick?: () => void;
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

  return (
    <motion.div
      id={`m-${message.id}`}
      // The "zing": messages arrive with a short flick rather than a fade.
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      className={`relative flex w-full rounded-xl transition-colors duration-700
        ${mine ? 'justify-end' : 'justify-start'}
        ${highlighted ? 'bg-zing/15' : ''}`}
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
        className={`relative max-w-[78%] touch-pan-y px-3 py-2 text-[15px] leading-snug
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
          <span className="break-words whitespace-pre-wrap">{message.text}</span>
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
            {message.edited && <span>Edited</span>}
            {bubbleTime(message.createdAt)}
            {mine && !message.deleted && <Ticks state={tick} />}
          </span>
        )}
      </motion.div>
    </motion.div>
  );
}
