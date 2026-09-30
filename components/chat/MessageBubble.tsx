'use client';

import { motion } from 'motion/react';
import { bubbleTime } from '@/lib/format';
import { Ticks, type TickState } from './Ticks';
import type { DecryptedMessage } from '@/lib/db/schema';

export function MessageBubble({
  message,
  mine,
  tick,
  tailed,
  onRetry,
  onDiscard,
}: {
  message: DecryptedMessage;
  mine: boolean;
  tick: TickState;
  /** Last in a run from the same sender -- only that one gets the tail corner. */
  tailed: boolean;
  /** Only used for failed messages. */
  onRetry?: () => void;
  onDiscard?: () => void;
}) {
  return (
    <motion.div
      // The "zing": messages arrive with a short flick rather than a fade.
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      className={`flex w-full ${mine ? 'justify-end' : 'justify-start'}`}
    >
      <div
        className={`relative max-w-[78%] px-3 py-2 text-[15px] leading-snug
          ${mine ? 'bg-bubble-out text-ink' : 'bg-bubble-in text-ink'}
          ${
            mine
              ? `rounded-2xl ${tailed ? 'rounded-br-sm' : ''}`
              : `rounded-2xl ${tailed ? 'rounded-bl-sm' : ''}`
          }`}
      >
        {message.text === null ? (
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
            {bubbleTime(message.createdAt)}
            {mine && <Ticks state={tick} />}
          </span>
        )}
      </div>
    </motion.div>
  );
}
