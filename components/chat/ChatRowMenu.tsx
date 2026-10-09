'use client';

import { MAX_PINNED } from '@/lib/db/schema';

/**
 * Long-press / right-click actions for one chat in the list: pin, favourite,
 * mute, archive. All are the owner's own preferences -- the other person
 * never finds out.
 */
export function ChatRowMenu({
  name,
  pinned,
  muted,
  archived,
  favourite,
  pinnedCount,
  onPin,
  onMute,
  onArchive,
  onFavourite,
  onClose,
}: {
  name: string;
  pinned: boolean;
  muted: boolean;
  archived: boolean;
  favourite: boolean;
  pinnedCount: number;
  onPin: (on: boolean) => void;
  onMute: (on: boolean) => void;
  onArchive: (on: boolean) => void;
  onFavourite: (on: boolean) => void;
  onClose: () => void;
}) {
  const pinFull = !pinned && pinnedCount >= MAX_PINNED;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm md:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label={`Chat with ${name}`}
        onClick={(event) => event.stopPropagation()}
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto scroll-thin rounded-t-3xl border-t border-line bg-surface p-3
          pb-[max(0.75rem,env(safe-area-inset-bottom))] md:rounded-3xl md:border"
      >
        <p className="mx-3 mt-2 mb-2 truncate text-[15px] font-semibold">{name}</p>
        <ul className="flex flex-col">
          {!archived && (
            <Item
              label={pinned ? 'Unpin chat' : 'Pin chat'}
              hint={pinFull ? `You can pin up to ${MAX_PINNED} chats. Unpin one first.` : undefined}
              disabled={pinFull}
              icon="M9 4h6l-1 5 3 3v2H7v-2l3-3zM12 14v6"
              onClick={() => {
                onPin(!pinned);
                onClose();
              }}
            />
          )}
          <Item
            label={favourite ? 'Remove from favourites' : 'Add to favourites'}
            hint={favourite ? undefined : 'Shows it under the Favourites filter.'}
            icon="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z"
            onClick={() => {
              onFavourite(!favourite);
              onClose();
            }}
          />
          <Item
            label={muted ? 'Unmute notifications' : 'Mute notifications'}
            hint={muted ? undefined : 'No push notifications from this chat. Messages still arrive.'}
            icon={
              muted
                ? 'M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0'
                : 'M6 16V11a6 6 0 0 1 9-5.2M18 11v5l1.5 2H8M10 20a2 2 0 0 0 4 0M4 4l16 16'
            }
            onClick={() => {
              onMute(!muted);
              onClose();
            }}
          />
          <Item
            label={archived ? 'Unarchive chat' : 'Archive chat'}
            hint={archived ? undefined : 'Moves it out of your list. New messages keep it there.'}
            icon="M4 5h16v4H4zM5 9v10h14V9M10 13h4"
            onClick={() => {
              onArchive(!archived);
              onClose();
            }}
          />
        </ul>
      </div>
    </div>
  );
}

function Item({
  label,
  hint,
  icon,
  disabled,
  onClick,
}: {
  label: string;
  hint?: string;
  icon: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        onClick={onClick}
        disabled={disabled}
        className="flex min-h-12 w-full items-center gap-4 rounded-2xl px-3 py-2 text-left text-[15px]
          text-ink transition-colors hover:bg-elevated disabled:opacity-50 disabled:hover:bg-transparent"
      >
        <svg viewBox="0 0 24 24" className="size-5 shrink-0" aria-hidden="true">
          <path d={icon} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>
          {label}
          {hint && <span className="block text-[12px] text-muted">{hint}</span>}
        </span>
      </button>
    </li>
  );
}
