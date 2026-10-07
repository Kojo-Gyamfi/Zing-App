'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/store/session';
import { findByUsername } from '@/lib/db/users';
import { ensureDirectChat } from '@/lib/db/chats';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import type { UserDoc } from '@/lib/db/schema';

/**
 * Where a shared profile link lands: zing.app/u/kwame.
 *
 * Only public profile fields are shown -- the same ones any signed-in user can
 * already look up by @username. The phone number is not, because the person
 * opening the link does not have a chat with them yet.
 */
export default function SharedProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const { username: raw } = use(params);
  // A malformed escape in the link (/u/%E0) is left encoded by the router and
  // would make decodeURIComponent throw -- the whole page, every retry.
  const username = safeDecode(raw);
  const router = useRouter();
  const { user, identity } = useSession();

  // undefined while loading, null when there is no such user.
  const [person, setPerson] = useState<UserDoc | null | undefined>(undefined);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void findByUsername(username)
      .catch(() => null)
      .then((found) => {
        if (live) setPerson(found);
      });
    return () => {
      live = false;
    };
  }, [username]);

  async function message(peer: UserDoc) {
    if (!user || !identity) return;
    setStarting(true);
    setError(null);
    try {
      const chatId = await ensureDirectChat({ uid: user.uid, identity }, peer);
      router.replace(`/chats/${chatId}`);
    } catch {
      setError('Could not start the chat. Check your connection and try again.');
      setStarting(false);
    }
  }

  const isMe = person?.uid === user?.uid;

  return (
    <div className="flex h-dvh flex-col bg-void">
      <header className="flex items-center gap-2 border-b border-line bg-surface px-2 pt-safe">
        <Link
          href="/chats"
          aria-label="Back to chats"
          className="grid size-10 place-items-center rounded-full text-muted hover:bg-elevated"
        >
          <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
            <path d="M15 5 8 12l7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
        <h1 className="py-3 text-lg font-semibold">Profile</h1>
      </header>

      <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center gap-5 p-6 text-center">
        {person === undefined ? (
          <div className="flex items-center gap-2 py-16 text-muted">
            <Spinner />
            <span className="text-sm">Loading</span>
          </div>
        ) : person === null ? (
          <div className="space-y-2 py-16">
            <p className="text-[15px] text-ink">This profile doesn&apos;t exist.</p>
            <p className="text-[13px] text-muted">
              The link may be mistyped, or @{username} was never taken.
            </p>
          </div>
        ) : (
          <>
            <Avatar name={person.displayName} photoURL={person.photoURL} size={112} />
            <div>
              <p className="text-2xl font-semibold">{person.displayName}</p>
              <p className="text-[15px] text-muted">@{person.username}</p>
            </div>
            {person.about?.trim() && (
              <p className="max-w-xs text-[14px] break-words text-muted">{person.about}</p>
            )}

            {isMe ? (
              <p className="text-[13px] text-faint">This is your profile.</p>
            ) : (
              <Button onClick={() => message(person)} busy={starting} className="w-full">
                Message
              </Button>
            )}
            {error && <p className="text-[13px] text-danger">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
