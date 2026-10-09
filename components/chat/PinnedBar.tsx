'use client';

import { useState } from 'react';
import { plainText } from '@/lib/formatting';
import type { DecryptedMessage } from '@/lib/db/schema';

/**
 * The pinned messages, one at a time under the header, as on WhatsApp.
 * Tapping jumps to the one shown and moves the bar on to the next, so a few
 * taps walk through them all. The text is this device's own decrypted copy;
 * the chat doc holds only the ids.
 */
export function PinnedBar({
  pinned,
  onJump,
}: {
  /** Oldest pin first. */
  pinned: DecryptedMessage[];
  onJump: (id: string) => void;
}) {
  // Counted from the newest pin, which is the one shown first.
  const [step, setStep] = useState(0);
  if (pinned.length === 0) return null;

  const index = pinned.length - 1 - (step % pinned.length);
  const message = pinned[index];

  return (
    <button
      onClick={() => {
        onJump(message.id);
        setStep((current) => current + 1);
      }}
      aria-label={`Pinned message${pinned.length > 1 ? ` ${index + 1} of ${pinned.length}` : ''}: go to it`}
      className="flex items-center gap-3 border-b border-line bg-surface px-4 py-2 text-left transition-colors hover:bg-elevated"
    >
      {pinned.length > 1 && (
        // One segment per pin, the one shown lit -- WhatsApp's side ticks.
        <span className="flex h-8 flex-col gap-0.5" aria-hidden="true">
          {pinned.map((entry, position) => (
            <span
              key={entry.id}
              className={`w-0.5 flex-1 rounded-full ${position === index ? 'bg-zing' : 'bg-line'}`}
            />
          ))}
        </span>
      )}
      <svg viewBox="0 0 24 24" className="size-4 shrink-0 text-muted" aria-hidden="true">
        <path
          d="M9 4h6l-1 5 3 3v2H7v-2l3-3zM12 14v6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] font-semibold text-zing">
          Pinned message{pinned.length > 1 ? ` ${index + 1} of ${pinned.length}` : ''}
        </span>
        <span className="block truncate text-[13px] text-muted">
          {message.text !== null ? plainText(message.text) : 'Can’t be decrypted on this device'}
        </span>
      </span>
    </button>
  );
}
