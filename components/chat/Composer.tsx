'use client';

import { useEffect, useRef, useState } from 'react';

/** What the next send means, besides "a new message". */
export type ComposerContext =
  | { kind: 'reply'; id: string; author: string; text: string | null }
  | { kind: 'edit'; id: string; text: string }
  | null;

export function Composer({
  onSend,
  onTyping,
  disabled,
  context = null,
  onCancelContext,
}: {
  onSend: (text: string) => void | Promise<void>;
  onTyping: () => void;
  disabled?: boolean;
  context?: ComposerContext;
  onCancelContext?: () => void;
}) {
  const [text, setText] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);

  // Starting an edit loads that message's text; leaving one clears the box
  // so the old text is not accidentally sent as a new message. Adjusted
  // during render rather than in an effect, so there is no flash of the
  // previous contents.
  const editId = context?.kind === 'edit' ? context.id : null;
  const [loadedEdit, setLoadedEdit] = useState<string | null>(null);
  if (editId !== loadedEdit) {
    setLoadedEdit(editId);
    if (context?.kind === 'edit') setText(context.text);
    else if (loadedEdit) setText('');
  }

  // Swiping to reply or choosing Edit should land the cursor in the box.
  const contextId = context?.id ?? null;
  useEffect(() => {
    if (!contextId) return;
    const node = box.current;
    node?.focus();
    node?.setSelectionRange(node.value.length, node.value.length);
    grow();
  }, [contextId]);

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

  const editing = context?.kind === 'edit';

  return (
    // Bottom padding is whichever is larger: breathing room, or the home
    // indicator inset on notched phones. pb-safe alone is 0 on most devices.
    <div
      className="border-t border-line bg-surface px-3 pt-2.5
        pb-[max(0.875rem,env(safe-area-inset-bottom))]"
    >
      {context && (
        <div className="mb-2 flex items-center gap-2 rounded-xl border-l-[3px] border-zing bg-elevated py-1.5 pr-1 pl-3">
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-semibold text-zing">
              {editing ? 'Editing message' : `Replying to ${context.author}`}
            </p>
            <p className="truncate text-[13px] text-muted">
              {context.kind === 'reply'
                ? (context.text ?? 'Message')
                : context.text}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onCancelContext?.()}
            aria-label={editing ? 'Cancel editing' : 'Cancel reply'}
            className="grid size-8 shrink-0 place-items-center rounded-full text-muted hover:text-ink"
          >
            <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      )}

      <div className="flex items-end gap-2">
        <textarea
          ref={box}
          rows={1}
          value={text}
          disabled={disabled}
          onChange={(event) => {
            setText(event.target.value);
            grow();
            if (!editing) onTyping();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && context) {
              event.preventDefault();
              onCancelContext?.();
              return;
            }
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
          aria-label={editing ? 'Save edit' : 'Send'}
          className="mb-0.5 grid size-11 shrink-0 place-items-center rounded-full bg-zing
            text-on-zing transition-transform duration-150 active:scale-90
            disabled:opacity-30 disabled:active:scale-100"
        >
          {editing ? (
            <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
              <path
                d="M5 12.5 10 17.5 19 7"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
              <path d="M3.4 20.4 21 12 3.4 3.6 3.4 10.2 15 12 3.4 13.8z" fill="currentColor" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
