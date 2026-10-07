'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useChatList, type ChatListRow } from '@/lib/hooks/useChatList';
import { useChatPrefs } from '@/lib/hooks/useChatPrefs';
import { useSession } from '@/lib/store/session';
import { useTypingChats } from '@/lib/hooks/useTypingChats';
import { setChatPref, type ChatPrefs } from '@/lib/db/prefs';
import { listTime } from '@/lib/format';
import { setAppBadge } from '@/lib/badge';
import { useMyPhoto } from '@/lib/store/account';
import { Avatar } from '@/components/ui/Avatar';
import { Spinner } from '@/components/ui/Spinner';
import { NotificationPrompt } from '@/components/NotificationPrompt';
import { ChatRowMenu } from './ChatRowMenu';

const LONG_PRESS_MS = 450;

export function ChatListPanel() {
  const { rows, loading, hasMore, loadMore } = useChatList();
  const profile = useSession((state) => state.profile);
  const myPhoto = useMyPhoto(profile?.photoURL);
  const pathname = usePathname();
  const [filter, setFilter] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [menuFor, setMenuFor] = useState<ChatListRow | null>(null);
  const myUid = useSession((state) => state.user?.uid);
  const prefs = useChatPrefs(myUid);
  const typing = useTypingChats(
    myUid,
    useMemo(() => rows.filter((row) => !row.peerDeleted).map((row) => row.id), [rows]),
  );

  const flags = useMemo(
    () => ({
      pinned: new Set(prefs.pinned),
      muted: new Set(prefs.muted),
      archived: new Set(prefs.archived),
    }),
    [prefs],
  );

  const archivedRows = useMemo(() => rows.filter((row) => flags.archived.has(row.id)), [rows, flags]);
  const searching = filter.trim().length > 0;

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    // Search looks everywhere, archive included, like WhatsApp's.
    if (needle) {
      return rows.filter(
        (row) =>
          row.peer?.displayName.toLowerCase().includes(needle) ||
          row.peer?.username.includes(needle),
      );
    }
    if (showArchived) return archivedRows;
    // Pinned on top, each group newest first (rows already arrive that way).
    const inbox = rows.filter((row) => !flags.archived.has(row.id));
    return [
      ...inbox.filter((row) => flags.pinned.has(row.id)),
      ...inbox.filter((row) => !flags.pinned.has(row.id)),
    ];
  }, [rows, filter, showArchived, archivedRows, flags]);

  const archivedUnread = archivedRows.filter((row) => row.unread).length;

  // The installed app's icon badge: unread messages, muted chats left out as
  // they are from notifications. Only the chats loaded so far are counted.
  const badge = useMemo(
    () => rows.reduce((total, row) => total + (flags.muted.has(row.id) ? 0 : row.unreadCount), 0),
    [rows, flags],
  );
  useEffect(() => {
    if (!loading) setAppBadge(badge);
  }, [badge, loading]);

  function toggle(pref: keyof ChatPrefs, chatId: string, on: boolean) {
    if (myUid) void setChatPref(myUid, pref, chatId, on).catch(() => undefined);
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 px-4 pt-safe pb-3">
        {showArchived && !searching ? (
          <div className="flex flex-1 items-center gap-1 pt-3">
            <button
              onClick={() => setShowArchived(false)}
              aria-label="Back to chats"
              className="-ml-2 grid size-10 place-items-center rounded-full text-muted transition-colors hover:bg-elevated"
            >
              <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
                <path d="M15 5 8 12l7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <h1 className="text-xl font-bold tracking-tight">Archived</h1>
          </div>
        ) : (
          <div className="flex flex-1 items-center gap-2 pt-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/zing-mark.png" alt="" className="size-8 glow-zing-sm" />
            <h1 className="text-xl font-bold tracking-tight">Zing</h1>
          </div>
        )}

        <Link
          href="/starred"
          aria-label="Starred messages"
          className="mt-3 grid size-10 place-items-center rounded-full text-muted transition-colors hover:bg-elevated hover:text-ink"
        >
          <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
            <path
              d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
          </svg>
        </Link>

        <Link
          href="/settings"
          aria-label="Settings"
          className="mt-3 rounded-full p-1 transition-colors hover:bg-elevated"
        >
          <Avatar name={profile?.displayName ?? '?'} photoURL={myPhoto} size={32} />
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

      <div
        className="min-h-0 flex-1 overflow-y-auto scroll-thin"
        onScroll={(event) => {
          const node = event.currentTarget;
          // Next page a screen before the end, so it is there by the time the
          // reader gets to it.
          if (hasMore && node.scrollHeight - node.scrollTop - node.clientHeight < node.clientHeight) {
            loadMore();
          }
        }}
      >
        {!loading && !showArchived && !searching && archivedRows.length > 0 && (
          <button
            onClick={() => setShowArchived(true)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface"
          >
            <span className="grid size-[50px] shrink-0 place-items-center text-muted">
              <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
                <path d="M4 5h16v4H4zM5 9v10h14V9M10 13h4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="flex-1 font-semibold">Archived</span>
            <span className={`text-[13px] ${archivedUnread ? 'text-zing' : 'text-faint'}`}>
              {archivedUnread || archivedRows.length}
            </span>
          </button>
        )}

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-muted">
            <Spinner />
            <span className="text-sm">Decrypting your chats</span>
          </div>
        ) : visible.length === 0 ? (
          <EmptyState searching={searching} archive={showArchived} />
        ) : (
          <ul>
            {visible.map((row) => (
              <ChatRow
                key={row.id}
                row={row}
                active={pathname === `/chats/${row.id}`}
                typing={typing.has(row.id)}
                pinned={flags.pinned.has(row.id) && !flags.archived.has(row.id)}
                muted={flags.muted.has(row.id)}
                onMenu={() => setMenuFor(row)}
              />
            ))}
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

      {menuFor && (
        <ChatRowMenu
          name={menuFor.peer?.displayName ?? (menuFor.peerDeleted ? 'Deleted account' : 'Chat')}
          pinned={flags.pinned.has(menuFor.id)}
          muted={flags.muted.has(menuFor.id)}
          archived={flags.archived.has(menuFor.id)}
          pinnedCount={rows.filter((row) => flags.pinned.has(row.id) && !flags.archived.has(row.id)).length}
          onPin={(on) => toggle('pinned', menuFor.id, on)}
          onMute={(on) => toggle('muted', menuFor.id, on)}
          onArchive={(on) => toggle('archived', menuFor.id, on)}
          onClose={() => setMenuFor(null)}
        />
      )}
    </div>
  );
}

/**
 * One chat. Long-press (touch) or right-click opens its menu; on desktop a
 * chevron appears on hover too, since right-click is not discoverable.
 */
function ChatRow({
  row,
  active,
  typing,
  pinned,
  muted,
  onMenu,
}: {
  row: ChatListRow;
  active: boolean;
  typing: boolean;
  pinned: boolean;
  muted: boolean;
  onMenu: () => void;
}) {
  const pressTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pressStart = useRef<{ x: number; y: number } | null>(null);
  // The click that ends a long-press must not also open the chat.
  const pressed = useRef(false);

  function cancelPress() {
    clearTimeout(pressTimer.current);
    pressStart.current = null;
  }

  return (
    <li className="group relative">
      <Link
        href={`/chats/${row.id}`}
        onPointerDown={(event) => {
          pressed.current = false;
          if (event.pointerType === 'mouse') return;
          pressStart.current = { x: event.clientX, y: event.clientY };
          pressTimer.current = setTimeout(() => {
            pressStart.current = null;
            pressed.current = true;
            navigator.vibrate?.(10);
            onMenu();
          }, LONG_PRESS_MS);
        }}
        onPointerMove={(event) => {
          const start = pressStart.current;
          if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) cancelPress();
        }}
        onPointerUp={cancelPress}
        onPointerCancel={cancelPress}
        onClick={(event) => {
          if (pressed.current) {
            event.preventDefault();
            pressed.current = false;
          }
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          cancelPress();
          onMenu();
        }}
        // no-callout: iOS would otherwise open its own link preview on a
        // long-press, on top of ours.
        className={`flex items-center gap-3 px-4 py-3 transition-colors select-none [-webkit-touch-callout:none]
          ${active ? 'bg-elevated' : 'hover:bg-surface'}`}
      >
        <Avatar name={row.peer?.displayName ?? '?'} photoURL={row.peer?.photoURL} size={50} />

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate font-semibold">
              {row.peer?.displayName ?? (row.peerDeleted ? 'Deleted account' : 'Unknown')}
            </span>
            <span className={`shrink-0 text-[12px] ${row.unread && !muted ? 'text-zing' : 'text-faint'}`}>
              {listTime(row.updatedAt)}
            </span>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className={`truncate text-[14px] ${row.unread ? 'text-ink' : 'text-muted'}`}>
              {typing ? (
                <span className="font-medium text-zing">typing…</span>
              ) : row.preview === null ? (
                row.lastSenderId ? 'Encrypted message' : 'Say hello'
              ) : (
                row.preview
              )}
            </span>

            <span className="flex shrink-0 items-center gap-1.5 text-faint">
              {muted && (
                <svg viewBox="0 0 24 24" className="size-4" role="img" aria-label="Muted">
                  <path
                    d="M6 16V11a6 6 0 0 1 9-5.2M18 11v5l1.5 2H8M10 20a2 2 0 0 0 4 0M4 4l16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
              {pinned && (
                <svg viewBox="0 0 24 24" className="size-4" role="img" aria-label="Pinned">
                  <path
                    d="M9 4h6l-1 5 3 3v2H7v-2l3-3zM12 14v6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
              {row.unread && (
                <span
                  aria-label={`${row.unreadCount} unread`}
                  className={`grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[11px] leading-none font-semibold
                    ${muted ? 'bg-faint text-void' : 'bg-zing text-on-zing'}`}
                >
                  {row.unreadCount > 99 ? '99+' : row.unreadCount}
                </span>
              )}
            </span>
          </div>
        </div>
      </Link>

      <button
        onClick={onMenu}
        aria-label="Chat options"
        className="absolute top-2 right-2 hidden size-7 place-items-center rounded-full bg-surface text-muted
          opacity-0 transition-opacity group-hover:opacity-100 hover:text-ink focus-visible:opacity-100 md:grid"
      >
        <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
          <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </li>
  );
}

function EmptyState({ searching, archive }: { searching: boolean; archive: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2 px-8 py-16 text-center">
      <p className="text-[15px] text-muted">
        {searching ? 'No chats match that.' : archive ? 'No archived chats.' : 'No conversations yet.'}
      </p>
      {!searching && !archive && (
        <p className="text-[13px] leading-relaxed text-faint">
          Tap the pencil to find someone by their @username.
        </p>
      )}
    </div>
  );
}
