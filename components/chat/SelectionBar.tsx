'use client';

import { useState } from 'react';
import { Sheet } from './Sheet';

const ICONS = {
  close: 'M6 6l12 12M18 6 6 18',
  reply: 'M10 8 5 12l5 4M5 12h9a5 5 0 0 1 5 5v1',
  star: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z',
  copy: 'M8 8h11v12H8zM5 16V4h11',
  forward: 'M14 8l5 4-5 4M19 12h-9a5 5 0 0 0-5 5v1',
  delete: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
} as const;

/**
 * The header while several messages are selected, as on WhatsApp: how many,
 * and what can be done to all of them. An action shows only when it fits
 * every one selected -- no copying a deleted message, no forwarding a
 * view-once one.
 */
export function SelectionBar({
  count,
  canReply,
  canStar,
  allStarred,
  canCopy,
  canForward,
  onReply,
  onStar,
  onCopy,
  onForward,
  onDelete,
  onCancel,
}: {
  count: number;
  canReply: boolean;
  canStar: boolean;
  allStarred: boolean;
  canCopy: boolean;
  canForward: boolean;
  onReply: () => void;
  onStar: (on: boolean) => void;
  onCopy: () => Promise<boolean>;
  onForward: () => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <header
      className="flex items-center gap-1 border-b border-line bg-surface px-2 pt-safe"
      aria-label={`${count} selected`}
    >
      <Action label="Cancel selection" icon={ICONS.close} onClick={onCancel} />
      <p className="min-w-0 flex-1 py-4 pl-1 text-[16px] font-semibold tabular-nums" aria-live="polite">
        {copied ? 'Copied' : `${count} selected`}
      </p>
      {canReply && <Action label="Reply" icon={ICONS.reply} onClick={onReply} />}
      {canStar && (
        <Action
          label={allStarred ? 'Unstar' : 'Star'}
          icon={ICONS.star}
          filled={allStarred}
          onClick={() => onStar(!allStarred)}
        />
      )}
      {canCopy && (
        <Action
          label="Copy"
          icon={ICONS.copy}
          onClick={() =>
            void onCopy().then((ok) => {
              if (!ok) return;
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            })
          }
        />
      )}
      {canForward && <Action label="Forward" icon={ICONS.forward} onClick={onForward} />}
      <Action label="Delete" icon={ICONS.delete} onClick={onDelete} danger />
    </header>
  );
}

function Action({
  label,
  icon,
  filled,
  danger,
  onClick,
}: {
  label: string;
  icon: string;
  filled?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`grid size-10 shrink-0 place-items-center rounded-full transition-colors hover:bg-elevated
        ${danger ? 'text-danger' : 'text-muted hover:text-ink'}`}
    >
      <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
        <path
          d={icon}
          fill={filled ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

/** "Delete 3 messages?", with the same choices as for one. */
export function DeleteSelectionSheet({
  count,
  forEveryone,
  selfChat,
  onDeleteForEveryone,
  onDeleteForMe,
  onClose,
}: {
  count: number;
  /** All mine and not deleted already: they can go for both. */
  forEveryone: boolean;
  selfChat: boolean;
  onDeleteForEveryone: () => void;
  onDeleteForMe: () => void;
  onClose: () => void;
}) {
  const what = count === 1 ? 'this message' : `${count} messages`;
  return (
    <Sheet label={`Delete ${what}?`} onClose={onClose}>
      <div role="alertdialog" aria-label={`Delete ${what}?`} className="space-y-2 p-3">
        <p className="text-[15px] font-medium text-ink">Delete {what}?</p>
        <p className="pb-1 text-[13px] leading-relaxed text-muted">
          {selfChat && forEveryone
            ? 'They’re erased from Zing’s servers and all your devices. This cannot be undone.'
            : forEveryone
              ? 'Delete for me removes them from your devices only. Delete for everyone erases them from Zing’s servers for both of you. Neither can be undone.'
              : 'They’ll be removed from your devices. The other person still has them. This cannot be undone.'}
        </p>
        {forEveryone && (
          <button
            onClick={() => {
              onDeleteForEveryone();
              onClose();
            }}
            className="h-11 w-full rounded-2xl bg-danger/15 text-[15px] font-medium text-danger"
          >
            {selfChat ? 'Delete' : 'Delete for everyone'}
          </button>
        )}
        {!(selfChat && forEveryone) && (
          <button
            onClick={() => {
              onDeleteForMe();
              onClose();
            }}
            className="h-11 w-full rounded-2xl bg-danger/15 text-[15px] font-medium text-danger"
          >
            Delete for me
          </button>
        )}
        <button onClick={onClose} className="h-11 w-full rounded-2xl bg-elevated text-[15px] text-ink">
          Cancel
        </button>
      </div>
    </Sheet>
  );
}
