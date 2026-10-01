'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useChatList } from '@/lib/hooks/useChatList';
import { useSession } from '@/lib/store/session';
import { listTime } from '@/lib/format';
import { Avatar } from '@/components/ui/Avatar';
import { Spinner } from '@/components/ui/Spinner';
import { NotificationPrompt } from '@/components/NotificationPrompt';

export function ChatListPanel() {
  const { rows, loading } = useChatList();
  const profile = useSession((state) => state.profile);
  const pathname = usePathname();
  const [filter, setFilter] = useState('');

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return rows;

    return rows.filter(
      (row) =>
        row.peer?.displayName.toLowerCase().includes(needle) ||
        row.peer?.username.includes(needle),
    );
  }, [rows, filter]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 px-4 pt-safe pb-3">
        <div className="flex flex-1 items-center gap-2 pt-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/zing-logo.png" alt="" className="size-8 rounded-lg" />
          <h1 className="text-xl font-bold tracking-tight">Zing</h1>
        </div>

        <Link
          href="/settings"
          aria-label="Settings"
          className="mt-3 rounded-full p-1 transition-colors hover:bg-elevated"
        >
          <Avatar name={profile?.displayName ?? '?'} photoURL={profile?.photoURL} size={32} />
        </Link>
      </header>

      <div className="px-4 pb-3">
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Search your chats"
          aria-label="Search your chats"
          className="h-10 w-full rounded-xl bg-surface px-4 text-[16px] text-ink
            placeholder:text-faint focus:outline-none focus:ring-1 focus:ring-zing"
        />
      </div>

      <NotificationPrompt />

      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-muted">
            <Spinner />
            <span className="text-sm">Decrypting your chats</span>
          </div>
        ) : visible.length === 0 ? (
          <EmptyState searching={filter.trim().length > 0} />
        ) : (
          <ul>
            {visible.map((row) => {
              const active = pathname === `/chats/${row.id}`;

              return (
                <li key={row.id}>
                  <Link
                    href={`/chats/${row.id}`}
                    className={`flex items-center gap-3 px-4 py-3 transition-colors
                      ${active ? 'bg-elevated' : 'hover:bg-surface'}`}
                  >
                    <Avatar
                      name={row.peer?.displayName ?? '?'}
                      photoURL={row.peer?.photoURL}
                      size={50}
                    />

                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate font-semibold">
                          {row.peer?.displayName ?? 'Unknown'}
                        </span>
                        <span
                          className={`shrink-0 text-[12px] ${row.unread ? 'text-zing' : 'text-faint'}`}
                        >
                          {listTime(row.updatedAt)}
                        </span>
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`truncate text-[14px] ${row.unread ? 'text-ink' : 'text-muted'}`}
                        >
                          {row.preview === null
                            ? row.lastSenderId
                              ? 'Encrypted message'
                              : 'Say hello'
                            : row.preview}
                        </span>

                        {row.unread && (
                          <span
                            aria-label={`${row.unreadCount} unread`}
                            className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-zing px-1.5 text-[11px] leading-none font-semibold text-on-zing"
                          >
                            {row.unreadCount > 99 ? '99+' : row.unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Link
        href="/chats/new"
        aria-label="New chat"
        className="absolute right-5 bottom-6 grid size-14 place-items-center rounded-2xl
          bg-zing text-on-zing shadow-lg shadow-black/40 transition-transform
          duration-150 active:scale-90 md:right-auto md:left-[310px]"
      >
        <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
          <path
            d="M4 19.5 4.6 15l9.9-9.9 4.4 4.4L9 19.4z M14.5 5.1 16.7 3a1.6 1.6 0 0 1 2.3 0l1.9 1.9a1.6 1.6 0 0 1 0 2.3l-2.1 2.1z"
            fill="currentColor"
          />
        </svg>
      </Link>
    </div>
  );
}

function EmptyState({ searching }: { searching: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2 px-8 py-16 text-center">
      <p className="text-[15px] text-muted">
        {searching ? 'No chats match that.' : 'No conversations yet.'}
      </p>
      {!searching && (
        <p className="text-[13px] leading-relaxed text-faint">
          Tap the pencil to find someone by their @username.
        </p>
      )}
    </div>
  );
}
