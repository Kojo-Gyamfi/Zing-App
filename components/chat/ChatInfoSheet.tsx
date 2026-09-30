'use client';

import { useEffect, useState } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { getPhone } from '@/lib/db/users';
import { lastSeenLabel } from '@/lib/format';
import type { Presence } from '@/lib/db/presence';
import type { UserDoc } from '@/lib/db/schema';

/** The other person's profile, opened by tapping their name in a chat. */
export function ChatInfoSheet({
  peer,
  presence,
  onClose,
}: {
  peer: UserDoc;
  presence: Presence;
  onClose: () => void;
}) {
  const joined = peer.createdAt?.toDate?.();

  // Readable because we share a chat with them; the rules deny it otherwise.
  // undefined while loading, so the row does not flash "No number" first.
  const [phone, setPhone] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void getPhone(peer.uid).then((number) => {
      // Accounts that have not opened Zing since the privacy change still keep
      // the number on their public profile; it is already visible there.
      const legacy = (peer as UserDoc & { phone?: string | null }).phone ?? null;
      if (live) setPhone(number ?? legacy);
    });
    return () => {
      live = false;
    };
  }, [peer]);

  const [shareState, setShareState] = useState<'idle' | 'copied'>('idle');

  // The link carries only the @username, which is already public. Whoever
  // opens it gets the profile and a Message button, not the phone number.
  async function share() {
    const url = `${window.location.origin}/u/${peer.username}`;
    const text = `Chat with ${peer.displayName} (@${peer.username}) on Zing`;

    if (navigator.share) {
      try {
        await navigator.share({ title: peer.displayName, text, url });
      } catch {
        // Dismissed the share sheet; nothing to do.
      }
      return;
    }

    try {
      await navigator.clipboard.writeText(`${text}: ${url}`);
      setShareState('copied');
      setTimeout(() => setShareState('idle'), 2000);
    } catch {
      // Clipboard blocked too; nothing more we can do without a share target.
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm md:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label={`${peer.displayName}'s profile`}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md space-y-5 rounded-t-3xl border-t border-line bg-surface
          p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:rounded-3xl md:border"
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <Avatar
            name={peer.displayName}
            photoURL={peer.photoURL}
            size={96}
            online={presence.online}
          />
          <div>
            <p className="text-xl font-semibold">{peer.displayName}</p>
            <p className="text-[14px] text-muted">@{peer.username}</p>
            <p className={`mt-1 text-[13px] ${presence.online ? 'text-zing' : 'text-faint'}`}>
              {lastSeenLabel(presence)}
            </p>
          </div>
        </div>

        <dl className="divide-y divide-line rounded-2xl border border-line bg-void">
          <div className="px-4 py-3">
            <dt className="text-[12px] text-muted">About</dt>
            <dd className="mt-0.5 text-[15px] break-words text-ink">
              {peer.about?.trim() || <span className="text-faint">Nothing here yet</span>}
            </dd>
          </div>

          <div className="px-4 py-3">
            <dt className="text-[12px] text-muted">Phone</dt>
            <dd className="mt-0.5 text-[15px]">
              {phone === undefined ? (
                <span className="text-faint">Loading…</span>
              ) : phone ? (
                <a href={`tel:${phone}`} className="text-zing">
                  {phone}
                </a>
              ) : (
                <span className="text-faint">No number added</span>
              )}
            </dd>
          </div>

          {joined && (
            <div className="px-4 py-3">
              <dt className="text-[12px] text-muted">On Zing since</dt>
              <dd className="mt-0.5 text-[15px] text-ink">
                {joined.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
              </dd>
            </div>
          )}
        </dl>

        <p className="flex items-center justify-center gap-1.5 text-[12px] text-faint">
          <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden="true">
            <path
              d="M4 7V5a4 4 0 0 1 8 0v2m-9 0h10v7H3z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
            />
          </svg>
          Messages are end-to-end encrypted
        </p>

        <div className="flex gap-2">
          <button
            onClick={() => void share()}
            className="flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-zing
              text-[15px] font-semibold text-on-zing"
          >
            <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
              <path
                d="M12 15V3m0 0L7.5 7.5M12 3l4.5 4.5M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {shareState === 'copied' ? 'Link copied' : 'Share profile'}
          </button>
          <button
            onClick={onClose}
            className="h-12 flex-1 rounded-2xl bg-elevated text-[15px] font-semibold text-ink"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
