'use client';

import { useEffect, useState } from 'react';
import { useAccount, useNicknames } from '@/lib/store/account';
import { nameFor } from '@/lib/names';
import { useProfiles } from '@/lib/store/profiles';
import { useSession } from '@/lib/store/session';
import { setBlocked, setPhotoVisibility, setPrivacy } from '@/lib/db/privacy';
import { directChatId } from '@/lib/db/chats';
import { Avatar } from '@/components/ui/Avatar';
import { Toggle } from './Toggle';
import type { PhotoVisibility } from '@/lib/db/schema';

const PHOTO_CHOICES: { value: PhotoVisibility; label: string }[] = [
  { value: 'everyone', label: 'Everyone' },
  { value: 'contacts', label: 'My contacts' },
  { value: 'nobody', label: 'Nobody' },
];

/**
 * Read receipts, last seen, profile photo and blocked people. Each setting
 * works by not publishing the data at all, so a modified client on the other
 * end gets nothing either.
 */
export function PrivacySettings({ uid, photoURL }: { uid: string; photoURL: string | null }) {
  const known = useAccount((state) => state.known);
  const privacy = useAccount((state) => state.settings.privacy);
  const blocked = useAccount((state) => state.settings.blocked);
  const refreshProfile = useSession((state) => state.refreshProfile);
  const [error, setError] = useState<string | null>(null);

  // Not awaited: the account listener shows the change from the local cache
  // at once, and offline the commit would wait for a reconnect.
  function save(write: Promise<void>, after?: () => void) {
    setError(null);
    write.then(after, () => setError('Could not save. Check your connection and try again.'));
  }

  return (
    <div className="space-y-3">
      <div className="divide-y divide-line rounded-2xl border border-line bg-surface">
        <Toggle
          label="Read receipts"
          hint="Off: people don’t see when you’ve read their messages, and you don’t see when they’ve read yours."
          on={privacy.readReceipts}
          disabled={!known}
          onChange={(on) => save(setPrivacy(uid, { readReceipts: on }))}
        />
        <Toggle
          label="Last seen & online"
          hint="Off: nobody sees when you’re online or were last here, and you don’t see theirs."
          on={privacy.lastSeen}
          disabled={!known}
          onChange={(on) => save(setPrivacy(uid, { lastSeen: on }))}
        />

        <div className="space-y-2.5 p-4">
          <div>
            <p className="text-[14px] font-medium text-ink">Profile photo</p>
            <p className="mt-1 text-[12px] leading-relaxed text-faint">
              Who can see it. Your contacts are the people you’ve both sent messages to.
            </p>
          </div>
          <div role="radiogroup" aria-label="Who can see my profile photo" className="flex gap-1.5">
            {PHOTO_CHOICES.map((choice) => (
              <button
                key={choice.value}
                role="radio"
                aria-checked={privacy.photo === choice.value}
                disabled={!known}
                onClick={() => {
                  if (privacy.photo === choice.value) return;
                  // The session's copy of the public profile changes too.
                  save(setPhotoVisibility(uid, choice.value, photoURL), () => void refreshProfile());
                }}
                className={`h-9 flex-1 rounded-xl text-[13px] font-medium transition-colors disabled:opacity-50
                  ${privacy.photo === choice.value ? 'bg-zing text-on-zing' : 'bg-elevated text-muted hover:text-ink'}`}
              >
                {choice.label}
              </button>
            ))}
          </div>
        </div>

        <BlockedList uid={uid} blocked={blocked} onError={setError} />
      </div>

      {error && <p className="text-[12px] text-danger">{error}</p>}
    </div>
  );
}

/** People this user has blocked, from the account doc, each with Unblock. */
function BlockedList({
  uid,
  blocked,
  onError,
}: {
  uid: string;
  blocked: string[];
  onError: (message: string) => void;
}) {
  const load = useProfiles((state) => state.load);
  const profiles = useProfiles((state) => state.profiles);
  const missing = useProfiles((state) => state.missing);
  const nicknames = useNicknames();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (open) blocked.forEach((peer) => void load(peer));
  }, [open, blocked, load]);

  return (
    <div className="p-4">
      <button
        onClick={() => setOpen(!open)}
        disabled={blocked.length === 0}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 text-left disabled:cursor-default"
      >
        <span>
          <span className="block text-[14px] font-medium text-ink">Blocked</span>
          <span className="mt-1 block text-[12px] text-faint">
            {blocked.length === 0
              ? 'Nobody. You can block someone from their profile in a chat.'
              : `${blocked.length} ${blocked.length === 1 ? 'person' : 'people'}`}
          </span>
        </span>
        {blocked.length > 0 && (
          <svg
            viewBox="0 0 24 24"
            className={`size-5 shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`}
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>

      {open && blocked.length > 0 && (
        <ul className="mt-3 space-y-1">
          {blocked.map((peer) => {
            const person = profiles[peer];
            const name = nameFor(person, nicknames, missing[peer] ? 'Deleted account' : 'Loading…');
            return (
              <li key={peer} className="flex items-center gap-3 py-1.5">
                <Avatar name={person ? name : '?'} photoURL={person?.photoURL} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] text-ink">{name}</p>
                  {person && <p className="truncate text-[12px] text-muted">@{person.username}</p>}
                </div>
                <button
                  onClick={() =>
                    void setBlocked(uid, directChatId(uid, peer), peer, false).catch(() =>
                      onError('Could not unblock. Check your connection and try again.'),
                    )
                  }
                  className="h-8 shrink-0 rounded-full bg-elevated px-3 text-[13px] font-medium text-zing"
                >
                  Unblock
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
