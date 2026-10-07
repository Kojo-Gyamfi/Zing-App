'use client';

import { useState } from 'react';
import { EDIT_WINDOW_MS, type DecryptedMessage } from '@/lib/db/schema';
import { QUICK_REACTIONS } from '@/lib/reactions';
import { EmojiPanel } from './EmojiPanel';

/**
 * Long-press / right-click actions for one message.
 *
 * Edit is offered only inside the window the security rules enforce, so the
 * option disappears rather than failing on save. Delete is "for everyone" and
 * irreversible, so both kinds of delete sit behind a second step.
 */
export function MessageMenu({
  message,
  mine,
  myReaction,
  starred,
  canReact,
  onReply,
  onEdit,
  onDelete,
  onDeleteForMe,
  onReact,
  onStar,
  onForward,
  onInfo,
  onClose,
}: {
  message: DecryptedMessage;
  mine: boolean;
  /** The emoji I already put on this message, if any. */
  myReaction: string | null;
  starred: boolean;
  /** False while the conversation key is missing: nothing to seal with. */
  canReact: boolean;
  onReply: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onDeleteForMe: () => void;
  /** Null takes my reaction back. */
  onReact: (emoji: string | null) => void;
  onStar: (on: boolean) => void;
  onForward: () => void;
  /** Delivered and read times, for my own messages. */
  onInfo: () => void;
  onClose: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);
  const [picking, setPicking] = useState(false);

  // Picking the emoji I already have takes it back, as on WhatsApp.
  function react(emoji: string) {
    onReact(emoji === myReaction ? null : emoji);
    onClose();
  }

  // Read once when the menu opens: a menu left open past the window just
  // fails on save, and the rules say why.
  const [editable] = useState(
    () =>
      mine &&
      !message.deleted &&
      message.text !== null &&
      !message.pending &&
      message.createdAt !== null &&
      Date.now() - message.createdAt.getTime() < EDIT_WINDOW_MS,
  );

  const canDeleteForEveryone = mine && !message.deleted;

  async function copy() {
    if (message.text === null) return;
    try {
      await navigator.clipboard.writeText(message.text);
      setCopied(true);
      setTimeout(onClose, 600);
    } catch {
      onClose();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm md:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Message actions"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md rounded-t-3xl border-t border-line bg-surface p-3
          pb-[max(0.75rem,env(safe-area-inset-bottom))] md:rounded-3xl md:border"
      >
        {canReact && !message.deleted && !confirming && (
          <div className="mx-1 mb-2 flex items-center justify-between gap-1 rounded-full bg-elevated p-1">
            {QUICK_REACTIONS.map((emoji) => (
              <button
                key={emoji}
                onClick={() => react(emoji)}
                aria-label={`React ${emoji}`}
                aria-pressed={myReaction === emoji}
                className={`grid size-10 place-items-center rounded-full text-[24px] leading-none
                  transition-transform active:scale-90
                  ${myReaction === emoji ? 'bg-zing/25' : 'hover:bg-line'}`}
              >
                {emoji}
              </button>
            ))}
            <button
              onClick={() => setPicking((open) => !open)}
              aria-label="More reactions"
              aria-expanded={picking}
              className={`grid size-10 place-items-center rounded-full text-muted transition-colors
                hover:text-ink ${picking ? 'bg-line text-ink' : ''}`}
            >
              <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
                <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        )}

        {picking && !confirming && <EmojiPanel onPick={react} />}

        {message.text !== null && !picking && (
          <p className="mx-3 mt-2 mb-3 line-clamp-3 text-[14px] text-muted">{message.text}</p>
        )}

        {picking ? null : confirming ? (
          <div className="space-y-2 p-3">
            <p className="text-[15px] font-medium text-ink">Delete message?</p>
            <p className="pb-1 text-[13px] leading-relaxed text-muted">
              {canDeleteForEveryone
                ? 'Delete for me removes it from your devices only. Delete for everyone erases it from Zing’s servers for both of you. Neither can be undone.'
                : 'It will be removed from your devices. The other person still has it. This cannot be undone.'}
            </p>
            {canDeleteForEveryone && (
              <button
                onClick={() => {
                  onDelete();
                  onClose();
                }}
                className="h-11 w-full rounded-2xl bg-danger/15 text-[15px] font-medium text-danger"
              >
                Delete for everyone
              </button>
            )}
            <button
              onClick={() => {
                onDeleteForMe();
                onClose();
              }}
              className="h-11 w-full rounded-2xl bg-danger/15 text-[15px] font-medium text-danger"
            >
              Delete for me
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="h-11 w-full rounded-2xl bg-elevated text-[15px] text-ink"
            >
              Cancel
            </button>
          </div>
        ) : (
          <ul className="flex flex-col">
            {!message.deleted && (
              <Action
                label="Reply"
                icon="M10 8 5 12l5 4M5 12h9a5 5 0 0 1 5 5v1"
                onClick={() => {
                  onReply();
                  onClose();
                }}
              />
            )}
            {message.text !== null && (
              <Action
                label={copied ? 'Copied' : 'Copy'}
                icon="M8 8h11v12H8zM5 16V4h11"
                onClick={() => void copy()}
              />
            )}
            {message.text !== null && !message.deleted && (
              <Action
                label="Forward"
                icon="M14 8l5 4-5 4M19 12h-9a5 5 0 0 0-5 5v1"
                onClick={() => {
                  onForward();
                  onClose();
                }}
              />
            )}
            {!message.deleted && !message.pending && (
              <Action
                label={starred ? 'Unstar' : 'Star'}
                icon="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"
                onClick={() => {
                  onStar(!starred);
                  onClose();
                }}
              />
            )}
            {mine && !message.deleted && !message.pending && (
              <Action
                label="Info"
                icon="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01"
                onClick={() => {
                  onInfo();
                  onClose();
                }}
              />
            )}
            {editable && (
              <Action
                label="Edit"
                icon="M4 20h4L19 9l-4-4L4 16zM13 7l4 4"
                onClick={() => {
                  onEdit();
                  onClose();
                }}
              />
            )}
            <Action
              label="Delete"
              icon="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"
              danger
              onClick={() => setConfirming(true)}
            />
          </ul>
        )}
      </div>
    </div>
  );
}

function Action({
  label,
  icon,
  danger,
  onClick,
}: {
  label: string;
  icon: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        onClick={onClick}
        className={`flex h-12 w-full items-center gap-4 rounded-2xl px-3 text-left text-[15px]
          transition-colors hover:bg-elevated ${danger ? 'text-danger' : 'text-ink'}`}
      >
        <svg viewBox="0 0 24 24" className="size-5 shrink-0" aria-hidden="true">
          <path
            d={icon}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {label}
      </button>
    </li>
  );
}
