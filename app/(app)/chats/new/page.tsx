'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/store/session';
import { findByUsername, findByPhone, normalizeUsername, USERNAME_PATTERN } from '@/lib/db/users';
import { ensureDirectChat } from '@/lib/db/chats';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import type { UserDoc } from '@/lib/db/schema';
import { useMyPhoto } from '@/lib/store/account';
import { QrScanner } from '@/components/QrScanner';

export default function NewChatPage() {
  const router = useRouter();
  const { user, identity, profile } = useSession();
  const myPhoto = useMyPhoto(profile?.photoURL);

  const [term, setTerm] = useState('');
  const [result, setResult] = useState<UserDoc | null>(null);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  async function search() {
    const query = term.trim();
    if (!query) return;

    setSearching(true);
    setSearched(false);
    setError(null);

    try {
      // A leading + or digit may be a number; anything else is a handle.
      // Handles may start with a digit too ("2fast"), so one that is no
      // number's owner is tried as a handle as well.
      const handle = normalizeUsername(query);
      let found = /^[+\d]/.test(query) ? await findByPhone(query) : null;
      if (!found && !query.startsWith('+') && USERNAME_PATTERN.test(handle)) {
        found = await findByUsername(handle);
      }

      // Finding myself is fine: that is the chat with myself.
      setResult(found);
      setSearched(true);
    } catch {
      // Offline with nothing cached: say so rather than spin forever.
      setResult(null);
      setError('Could not search. Check your connection and try again.');
    } finally {
      setSearching(false);
    }
  }

  async function start(peer: UserDoc) {
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

  return (
    <div className="flex h-dvh flex-col bg-void">
      <header className="flex items-center gap-2 border-b border-line bg-surface px-2 pt-safe">
        <Link
          href="/chats"
          aria-label="Back"
          className="grid size-10 place-items-center rounded-full text-muted hover:bg-elevated"
        >
          <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
            <path d="M15 5 8 12l7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
        <h1 className="py-3 text-lg font-semibold">New chat</h1>
      </header>

      <div className="space-y-4 p-4">
        <div className="flex gap-2">
          <input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && void search()}
            placeholder="@username or phone number"
            aria-label="Find someone"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            className="h-12 flex-1 rounded-2xl border border-line bg-surface px-4 text-[16px]
              text-ink placeholder:text-faint focus:border-zing focus:outline-none"
          />
          <Button onClick={search} busy={searching} disabled={!term.trim()}>
            Find
          </Button>
        </div>

        <button
          onClick={() => setScanning(true)}
          className="flex w-full items-center gap-3 rounded-2xl border border-line bg-surface p-3 text-left
            transition-colors hover:bg-elevated"
        >
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-zing/12 text-zing">
            <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
              <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold">Scan a QR code</span>
            <span className="block truncate text-[13px] text-muted">
              Point your camera at a friend’s Zing code
            </span>
          </span>
        </button>

        {profile && (
          <button
            onClick={() => void start(profile)}
            disabled={starting}
            className="flex w-full items-center gap-3 rounded-2xl border border-line bg-surface p-3 text-left
              transition-colors hover:bg-elevated disabled:opacity-60"
          >
            <Avatar name={profile.displayName} photoURL={myPhoto} size={44} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">Message yourself</span>
              <span className="block truncate text-[13px] text-muted">
                Notes, links and reminders, only you can read
              </span>
            </span>
            {starting && <Spinner />}
          </button>
        )}

        <p className="text-[12px] leading-relaxed text-faint">
          Zing can&apos;t read your phone&apos;s contacts — no website can. Ask your friend for their
          @username, or their number if they added one.
        </p>

        {searching && (
          <div className="flex items-center gap-2 py-6 text-muted">
            <Spinner />
            <span className="text-sm">Searching</span>
          </div>
        )}

        {error && <p className="text-center text-[13px] text-danger">{error}</p>}

        {searched && !searching && result === null && (
          <p className="py-6 text-center text-[14px] text-muted">
            Nobody found. Check the spelling — handles are exact.
          </p>
        )}

        {result && !searching && (
          <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3">
            <Avatar name={result.displayName} photoURL={result.photoURL} size={52} />

            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">
                {result.displayName}
                {result.uid === user?.uid && ' (You)'}
              </p>
              <p className="truncate text-[13px] text-muted">@{result.username}</p>
            </div>

            <Button onClick={() => start(result)} busy={starting}>
              {result.uid === user?.uid ? 'Message yourself' : 'Chat'}
            </Button>
          </div>
        )}
      </div>

      {scanning && (
        <QrScanner
          onUsername={(username) => {
            setScanning(false);
            router.push(`/u/${username}`);
          }}
          onClose={() => setScanning(false)}
        />
      )}
    </div>
  );
}
