'use client';

import { useEffect, useRef, useState } from 'react';
import { EmojiPanel } from './EmojiPanel';
import { MAX_MESSAGE_LENGTH } from '@/lib/db/schema';
import { plainText } from '@/lib/formatting';

/** What the next send means, besides "a new message". */
export type ComposerContext =
  | { kind: 'reply'; id: string; author: string; text: string | null }
  | { kind: 'edit'; id: string; text: string }
  | null;

export function Composer({
  onSend,
  onTyping,
  disabled,
  disabledText,
  context = null,
  onCancelContext,
  draft = '',
  onDraftChange,
}: {
  onSend: (text: string) => void | Promise<void>;
  onTyping: () => void;
  disabled?: boolean;
  /** Placeholder while disabled; defaults to the key-exchange wait. */
  disabledText?: string;
  context?: ComposerContext;
  onCancelContext?: () => void;
  /** Unsent text from last time. Read once, when the composer mounts. */
  draft?: string;
  /** Every change to the unsent text -- not while editing a sent message. */
  onDraftChange?: (text: string) => void;
}) {
  const [text, setText] = useState(draft);
  // What was being typed before an edit took over the box, put back after.
  const [kept, setKept] = useState(draft);
  const box = useRef<HTMLTextAreaElement>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  // Where the caret was last. On a phone the box loses focus while the emoji
  // panel is open (that is what hides the keyboard), so this is where taps land.
  const caret = useRef<{ start: number; end: number } | null>(null);
  // Whether the keyboard was up when Send was pressed; it stays up if so.
  const keepKeyboard = useRef(false);

  // Starting an edit loads that message's text; leaving one clears the box
  // so the old text is not accidentally sent as a new message. Adjusted
  // during render rather than in an effect, so there is no flash of the
  // previous contents.
  const editId = context?.kind === 'edit' ? context.id : null;
  const [loadedEdit, setLoadedEdit] = useState<string | null>(null);
  if (editId !== loadedEdit) {
    setLoadedEdit(editId);
    if (context?.kind === 'edit') {
      if (!loadedEdit) setKept(text);
      setText(context.text);
    } else if (loadedEdit) {
      setText(kept);
    }
  }

  // The draft is whatever is in the box while it is not holding an edit.
  const editing = context?.kind === 'edit';
  useEffect(() => {
    if (!editing) onDraftChange?.(text);
  }, [text, editing, onDraftChange]);

  // A restored draft may run to several lines.
  useEffect(() => {
    const node = box.current;
    if (!node || !node.value) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, 140)}px`;
  }, []);

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
    caret.current = null;
    requestAnimationFrame(grow);
    void onSend(value);
  }

  const isTouch = () => 'ontouchstart' in window;

  function rememberCaret() {
    const node = box.current;
    if (node) caret.current = { start: node.selectionStart, end: node.selectionEnd };
  }

  /** The remembered caret, or the end of the text; clamped in case the text changed since. */
  function currentCaret() {
    const fallback = { start: text.length, end: text.length };
    const { start, end } = caret.current ?? fallback;
    return { start: Math.min(start, text.length), end: Math.min(end, text.length) };
  }

  /** Replace the selection (or nothing, at the caret) and put the caret after it. */
  function replaceSelection(insert: string, deleteBefore = 0) {
    const { start, end } = currentCaret();
    const from = Math.max(0, start === end ? start - deleteBefore : start);
    const next = text.slice(0, from) + insert + text.slice(end);
    // maxLength only stops typing; an emoji tap would sail past it.
    if (next.length > MAX_MESSAGE_LENGTH) return;
    const position = from + insert.length;

    setText(next);
    caret.current = { start: position, end: position };
    if (!editing && insert) onTyping();

    requestAnimationFrame(() => {
      grow();
      const node = box.current;
      if (!node) return;
      // Refocusing on a phone would bring the keyboard back over the panel.
      if (!isTouch()) node.focus();
      node.setSelectionRange(position, position);
    });
  }

  function insertEmoji(emoji: string) {
    replaceSelection(emoji);
  }

  /** Backspace that removes a whole emoji (👨‍👩‍👧 is several code points), not half of one. */
  function backspace() {
    const { start, end } = currentCaret();
    if (start !== end) return replaceSelection('');
    if (start === 0) return;

    const before = text.slice(0, start);
    const segments = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(before)];
    const last = segments.at(-1)?.segment ?? '';
    replaceSelection('', last.length);
  }

  function toggleEmoji() {
    if (emojiOpen) {
      setEmojiOpen(false);
      // Back to typing, like WhatsApp's keyboard button.
      box.current?.focus();
      return;
    }
    rememberCaret();
    setEmojiOpen(true);
    // Dismiss the on-screen keyboard; the panel takes its place.
    if (isTouch()) box.current?.blur();
  }

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
                ? (context.text !== null ? plainText(context.text) : 'Message')
                : plainText(context.text)}
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
        <div className="flex min-w-0 flex-1 items-end rounded-2xl bg-elevated">
          <button
            type="button"
            onClick={toggleEmoji}
            disabled={disabled}
            aria-label={emojiOpen ? 'Show keyboard' : 'Emoji'}
            aria-expanded={emojiOpen}
            className="grid size-11 shrink-0 place-items-center rounded-full text-muted
              transition-colors hover:text-ink disabled:opacity-50"
          >
            {emojiOpen ? (
              <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="2.5" y="6" width="19" height="12" rx="2" />
                <path d="M6 9.5h.01M9 9.5h.01M12 9.5h.01M15 9.5h.01M18 9.5h.01M6 12.5h.01M9 12.5h.01M12 12.5h.01M15 12.5h.01M18 12.5h.01M8 15h8" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9.5" />
                <path d="M8 14.5s1.5 2 4 2 4-2 4-2" />
                <path d="M9 9.5h.01M15 9.5h.01" strokeWidth="2.6" />
              </svg>
            )}
          </button>
          <textarea
            ref={box}
            rows={1}
            value={text}
            disabled={disabled}
            onChange={(event) => {
              setText(event.target.value);
              rememberCaret();
              grow();
              if (!editing) onTyping();
            }}
            onSelect={rememberCaret}
            onBlur={rememberCaret}
            // Tapping the box on a phone means "keyboard please": the panel gives way.
            onFocus={() => {
              if (emojiOpen && isTouch()) setEmojiOpen(false);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && emojiOpen) {
                event.preventDefault();
                setEmojiOpen(false);
                return;
              }
              if (event.key === 'Escape' && context) {
                event.preventDefault();
                onCancelContext?.();
                return;
              }
              // Enter sends on a physical keyboard; Shift+Enter makes a new line.
              // On touch the on-screen return key inserts a newline as expected.
              if (
                event.key === 'Enter' &&
                !event.shiftKey &&
                // Enter that confirms a Chinese/Japanese/Korean input candidate is
                // not a send.
                !event.nativeEvent.isComposing &&
                !('ontouchstart' in window)
              ) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder={disabled ? (disabledText ?? 'Securing this chat…') : 'Message'}
            maxLength={MAX_MESSAGE_LENGTH}
            /* 16px keeps iOS from zooming the viewport when the field takes focus. */
            className="max-h-[140px] min-h-[44px] min-w-0 flex-1 resize-none bg-transparent py-3 pr-4
              text-[16px] leading-snug text-ink placeholder:text-faint
              focus:outline-none disabled:opacity-50"
          />
        </div>

        <button
          // Tapping Send must not take focus from the box: on a phone that
          // closes the keyboard after every message. Preventing the default
          // stops the focus move; refocusing in the click (still inside the
          // tap, which iOS requires) covers browsers that move it anyway.
          onPointerDown={(event) => {
            keepKeyboard.current = document.activeElement === box.current;
            event.preventDefault();
          }}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            submit();
            if (keepKeyboard.current) box.current?.focus();
            keepKeyboard.current = false;
          }}
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

      {text.length > MAX_MESSAGE_LENGTH - 500 && (
        <p
          className={`mt-1 text-right text-[12px] ${text.length >= MAX_MESSAGE_LENGTH ? 'text-danger' : 'text-faint'}`}
        >
          {MAX_MESSAGE_LENGTH - text.length} characters left
        </p>
      )}

      {emojiOpen && <EmojiPanel onPick={insertEmoji} onBackspace={backspace} />}
    </div>
  );
}
