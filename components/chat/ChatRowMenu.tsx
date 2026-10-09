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
  pinnedCount,
  onPin,
  onMute,
  onArchive,
  onFavourite,
  onClose,
}: {
  name: string;
  pinned: boolean;
  /** "Muted until ..." when muted, null when not (lib/mute.ts muteLabel). */
  muteStatus: string | null;
  archived: boolean;
  favourite: boolean;
  pinnedCount: number;
  onPin: (on: boolean) => void;
  onMute: (duration: MuteDuration | null) => void;
  onArchive: (on: boolean) => void;
  onFavourite: (on: boolean) => void;
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
