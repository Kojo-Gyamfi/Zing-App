'use client';

import { useRef, useState } from 'react';

export function Composer({
  onSend,
  onTyping,
  disabled,
}: {
  onSend: (text: string) => void | Promise<void>;
  onTyping: () => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);

  function grow() {
    const node = box.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, 140)}px`;
  }

  function submit() {
    const value = text.trim();
    if (!value || disabled) return;

    // Cleared before the write resolves: the optimistic bubble is already on
    // screen via the local cache, so waiting would only add lag.
    setText('');
    requestAnimationFrame(grow);
    void onSend(value);
  }

  return (
    <div className="flex items-end gap-2 border-t border-line bg-surface px-3 py-2 pb-safe">
      <textarea
        ref={box}
        rows={1}
        value={text}
        disabled={disabled}
        onChange={(event) => {
          setText(event.target.value);
          grow();
          onTyping();
        }}
        onKeyDown={(event) => {
          // Enter sends on a physical keyboard; Shift+Enter makes a new line.
          // On touch the on-screen return key inserts a newline as expected.
          if (event.key === 'Enter' && !event.shiftKey && !('ontouchstart' in window)) {
            event.preventDefault();
            submit();
          }
        }}
        placeholder={disabled ? 'Securing this chat…' : 'Message'}
        /* 16px keeps iOS from zooming the viewport when the field takes focus. */
        className="max-h-[140px] min-h-[44px] flex-1 resize-none rounded-2xl bg-elevated px-4 py-3
          text-[16px] leading-snug text-ink placeholder:text-faint
          focus:outline-none disabled:opacity-50"
      />

      <button
        onClick={submit}
        disabled={!text.trim() || disabled}
        aria-label="Send"
        className="mb-0.5 grid size-11 shrink-0 place-items-center rounded-full bg-zing
          text-on-zing transition-transform duration-150 active:scale-90
          disabled:opacity-30 disabled:active:scale-100"
      >
        <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
          <path d="M3.4 20.4 21 12 3.4 3.6 3.4 10.2 15 12 3.4 13.8z" fill="currentColor" />
        </svg>
      </button>
    </div>
  );
}
