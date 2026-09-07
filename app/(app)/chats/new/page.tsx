'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/store/session';
import { findByUsername, findByPhone, normalizeUsername } from '@/lib/db/users';
import { ensureDirectChat } from '@/lib/db/chats';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import type { UserDoc } from '@/lib/db/schema';

export default function NewChatPage() {
  const router = useRouter();
  const { user, identity } = useSession();

  const [term, setTerm] = useState('');
  const [result, setResult] = useState<UserDoc | null>(null);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [starting, setStarting] = useState(false);

  async function search() {
    const query = term.trim();
    if (!query) return;

    setSearching(true);
    setSearched(false);

    // A leading + or digits means they typed a number; anything else is a handle.
    const found = /^[+\d]/.test(query)
      ? await findByPhone(query)
      : await findByUsername(normalizeUsername(query));

    setResult(found && found.uid !== user?.uid ? found : null);
    setSearched(true);
    setSearching(false);
  }

  async function start(peer: UserDoc) {
    if (!user || !identity) return;

    setStarting(true);
    const chatId = await ensureDirectChat({ uid: user.uid, identity }, peer);
    router.replace(`/chats/${chatId}`);
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

        {searched && !searching && result === null && (
          <p className="py-6 text-center text-[14px] text-muted">
            Nobody found. Check the spelling — handles are exact.
          </p>
        )}

        {result && !searching && (
          <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3">
            <Avatar name={result.displayName} photoURL={result.photoURL} size={52} />

            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{result.displayName}</p>
              <p className="truncate text-[13px] text-muted">@{result.username}</p>
            </div>

            <Button onClick={() => start(result)} busy={starting}>
              Chat
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
