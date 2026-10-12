'use client';

import { useState } from 'react';
import { MAX_PINNED } from '@/lib/db/schema';
import type { MuteDuration } from '@/lib/mute';
import { ICONS, Sheet, SheetItem, SheetTitle } from './Sheet';
import { MutePicker } from './MutePicker';

/**
 * Long-press / right-click actions for one chat in the list: pin, favourite,
 * mute, archive. All are the owner's own preferences -- the other person
 * never finds out.
 */
export function ChatRowMenu({
  name,
  pinned,
  muteStatus,
  archived,
  favourite,
  unread,
  pinnedCount,
  onPin,
  onMute,
  onArchive,
  onFavourite,
  onMarkUnread,
  onClose,
}: {
  name: string;
  pinned: boolean;
  /** "Muted until ..." when muted, null when not (lib/mute.ts muteLabel). */
  muteStatus: string | null;
  archived: boolean;
  favourite: boolean;
  /** Waiting to be read, or marked unread by hand. */
  unread: boolean;
  pinnedCount: number;
  onPin: (on: boolean) => void;
  onMute: (duration: MuteDuration | null) => void;
  onArchive: (on: boolean) => void;
  onFavourite: (on: boolean) => void;
  onMarkUnread: (unread: boolean) => void;
  onClose: () => void;
}) {
  const [muting, setMuting] = useState(false);
  const pinFull = !pinned && pinnedCount >= MAX_PINNED;

  if (muting) {
    return (
      <Sheet label={`Mute ${name}`} onClose={onClose}>
        <SheetTitle onBack={() => setMuting(false)}>Mute notifications</SheetTitle>
        <MutePicker
          status={muteStatus}
          onChoose={(duration) => {
            onMute(duration);
            onClose();
          }}
        />
      </Sheet>
    );
  }

  return (
    <Sheet label={`Chat with ${name}`} onClose={onClose}>
      <SheetTitle>{name}</SheetTitle>
      <ul className="flex flex-col">
        {!archived && (
          <SheetItem
            label={pinned ? 'Unpin chat' : 'Pin chat'}
            hint={pinFull ? `You can pin up to ${MAX_PINNED} chats. Unpin one first.` : undefined}
            disabled={pinFull}
            icon={ICONS.pin}
            onClick={() => {
              onPin(!pinned);
              onClose();
            }}
          />
        )}
        <SheetItem
          label={unread ? 'Mark as read' : 'Mark as unread'}
          hint={unread ? undefined : 'Keeps it marked until you open it again. Only you see this.'}
          icon="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-4 3v-3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM17 7.5h.01"
          onClick={() => {
            onMarkUnread(!unread);
            onClose();
          }}
        />
        <SheetItem
          label={favourite ? 'Remove from favourites' : 'Add to favourites'}
          hint={favourite ? undefined : 'Shows it under the Favourites filter.'}
          icon={ICONS.favourite}
          onClick={() => {
            onFavourite(!favourite);
            onClose();
          }}
        />
        <SheetItem
          label={muteStatus ? 'Muted' : 'Mute notifications'}
          hint={muteStatus ?? 'No push notifications from this chat. Messages still arrive.'}
          icon={muteStatus ? ICONS.mute : ICONS.unmute}
          onClick={() => setMuting(true)}
        />
        <SheetItem
          label={archived ? 'Unarchive chat' : 'Archive chat'}
          hint={archived ? undefined : 'Moves it out of your list. New messages keep it there.'}
          icon={ICONS.archive}
          onClick={() => {
            onArchive(!archived);
            onClose();
          }}
        />
      </ul>
    </Sheet>
  );
}
