'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useChatList, type ChatListRow } from '@/lib/hooks/useChatList';
import { useChatPrefs } from '@/lib/hooks/useChatPrefs';
import { useSession } from '@/lib/store/session';
import { useTypingChats } from '@/lib/hooks/useTypingChats';
import { setChatPref, setMute, type ChatListPref } from '@/lib/db/prefs';
import { isMuted, muteLabel } from '@/lib/mute';
import { useMuteClock } from '@/lib/hooks/useMuteClock';
import { listTime } from '@/lib/format';
import { setAppBadge } from '@/lib/badge';
import { plainText } from '@/lib/formatting';
import { useMyPhoto, useNicknames, usePrivacy } from '@/lib/store/account';
import { clearUnread, markRead } from '@/lib/db/chats';
import { useMessageSearch, type MessageHit } from '@/lib/hooks/useMessageSearch';
import { splitMatches, normalizeForSearch } from '@/lib/search';
import { nameFor } from '@/lib/names';
import { useDrafts } from '@/lib/store/drafts';
import { Avatar } from '@/components/ui/Avatar';
import { Spinner } from '@/components/ui/Spinner';
import { NotificationPrompt } from '@/components/NotificationPrompt';
import { RecoveryPrompt } from '@/components/KeySafety';
import { ChatRowMenu } from './ChatRowMenu';

const LONG_PRESS_MS = 450;
const NO_DRAFTS: Record<string, string> = {};

/** The chips above the list. Each narrows the inbox; none reaches into Archived. */
type ListFilter = 'all' | 'unread' | 'favourites';
const FILTERS: { value: ListFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'unread', label: 'Unread' },
  { value: 'favourites', label: 'Favourites' },
];

export function ChatListPanel() {
  const { rows, loading, hasMore, loadMore, hidden } = useChatList();
  const profile = useSession((state) => state.profile);
  const myPhoto = useMyPhoto(profile?.photoURL);
  const pathname = usePathname();
  const [filter, setFilter] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [listFilter, setListFilter] = useState<ListFilter>('all');
  const [menuFor, setMenuFor] = useState<ChatListRow | null>(null);
  const myUid = useSession((state) => state.user?.uid);
  const nicknames = useNicknames();
  // What each row is called: my nickname for them, their name, or -- in the
  // chat with myself -- my own name, marked as me.
  const myName = profile?.displayName;
  const labelOf = useCallback(
    (row: ChatListRow) =>
      row.self
        ? `${myName ?? 'Me'} (You)`
        : nameFor(row.peer, nicknames, row.peerDeleted ? 'Deleted account' : 'Unknown'),
    [myName, nicknames],
  );
  const prefs = useChatPrefs(myUid);
  const privacy = usePrivacy();
  const typing = useTypingChats(
    myUid,
    useMemo(() => rows.filter((row) => !row.peerDeleted).map((row) => row.id), [rows]),
  );

  // Timed mutes end by themselves; this moves on when the next one does.
  const now = useMuteClock(prefs);
  const flags = useMemo(
    () => ({
      pinned: new Set(prefs.pinned),
      muted: { has: (chatId: string) => isMuted(prefs, chatId, now) },
      archived: new Set(prefs.archived),
      favourites: new Set(prefs.favourites),
      markedUnread: new Set(prefs.markedUnread),
    }),
    [prefs, now],
  );

  const archivedRows = useMemo(() => rows.filter((row) => flags.archived.has(row.id)), [rows, flags]);
  const searching = filter.trim().length > 0;

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    // Search looks everywhere, archive included, like WhatsApp's.
    if (needle) {
      return rows.filter(
        (row) =>
          labelOf(row).toLowerCase().includes(needle) ||
          Boolean(row.peer?.displayName.toLowerCase().includes(needle)) ||
          Boolean(row.peer?.username.includes(needle)) ||
          (row.self && 'message yourself'.includes(needle)),
      );
    }
    if (showArchived) return archivedRows;
    // Pinned on top, each group newest first (rows already arrive that way).
    const inbox = rows.filter((row) => {
      if (flags.archived.has(row.id)) return false;
      if (listFilter === 'favourites') return flags.favourites.has(row.id);
      // The open chat stays under Unread after reading it clears the badge,
      // as on WhatsApp -- otherwise it would vanish from beside the thread.
      if (listFilter === 'unread') {
        return row.unread || flags.markedUnread.has(row.id) || pathname === `/chats/${row.id}`;
      }
      return true;
    });
    return [
      ...inbox.filter((row) => flags.pinned.has(row.id)),
      ...inbox.filter((row) => !flags.pinned.has(row.id)),
    ];
  }, [rows, filter, showArchived, archivedRows, flags, listFilter, pathname, labelOf]);

  // Messages, across every chat, from what this device holds (see the hook).
  const messageSearch = useMessageSearch(filter, rows, hidden);

  const archivedUnread = archivedRows.filter(
    (row) => row.unread || flags.markedUnread.has(row.id),
  ).length;

  /**
   * "Mark as unread" puts a mark on my side only. "Mark as read" takes the
   * mark off and, for messages really waiting, reads them -- a read receipt
   * only if I share those (the privacy setting), the badge either way.
   */
  function markUnread(row: ChatListRow, on: boolean) {
    if (!myUid) return;
    toggle('markedUnread', row.id, on);
    if (!on && row.unread) {
      void (privacy.readReceipts ? markRead(row.id, myUid) : clearUnread(row.id, myUid)).catch(
        () => undefined,
      );
    }
  }

  // Searching, Archived and the filters look at loaded chats only, and the
  // next page loads on scroll -- which a short result list never does. Load
  // the rest while one of them is in use, a page at a time.
  const narrowed = searching || showArchived || listFilter !== 'all';
  useEffect(() => {
    if (narrowed && hasMore && !loading) loadMore();
  }, [narrowed, hasMore, loading, rows.length, loadMore]);

  // Unsent text per chat, from this device only. See lib/store/drafts.ts.
  const openDrafts = useDrafts((state) => state.open);
  const drafts = useDrafts((state) => (state.owner === myUid ? state.drafts : NO_DRAFTS));
  useEffect(() => {
    if (myUid) openDrafts(myUid);
  }, [myUid, openDrafts]);

  // The installed app's icon badge: unread messages, muted chats left out as
  // they are from notifications. Only the chats loaded so far are counted.
  const badge = useMemo(
    () => rows.reduce((total, row) => total + (flags.muted.has(row.id) ? 0 : row.unreadCount), 0),
    [rows, flags],
  );
  useEffect(() => {
    if (!loading) setAppBadge(badge);
  }, [badge, loading]);

  function toggle(pref: ChatListPref, chatId: string, on: boolean) {
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

      {!searching && !showArchived && (
        <div role="radiogroup" aria-label="Show" className="flex gap-2 px-4 pb-3">
          {FILTERS.map((choice) => (
            <button
              key={choice.value}
              role="radio"
              aria-checked={listFilter === choice.value}
              onClick={() => setListFilter(choice.value)}
              className={`h-8 rounded-full px-3.5 text-[13px] font-medium transition-colors
                ${
                  listFilter === choice.value
                    ? 'bg-zing text-on-zing'
                    : 'bg-surface text-muted hover:bg-elevated hover:text-ink'
                }`}
            >
              {choice.label}
            </button>
          ))}
        </div>
      )}

      <RecoveryPrompt />
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
        {!loading && !showArchived && !searching && listFilter === 'all' && (archivedRows.length > 0 || prefs.archived.length > 0) && (
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
              {archivedUnread || Math.max(archivedRows.length, prefs.archived.length)}
            </span>
          </button>
        )}

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-muted">
            <Spinner />
            <span className="text-sm">Decrypting your chats</span>
          </div>
        ) : searching ? (
          <SearchResults
            chats={visible.map((row) => (
              <ChatRow
                key={row.id}
                row={row}
                name={labelOf(row)}
                photoURL={row.self ? myPhoto : row.peer?.photoURL}
                active={pathname === `/chats/${row.id}`}
                typing={typing.has(row.id)}
                draft={drafts[row.id]}
                pinned={flags.pinned.has(row.id) && !flags.archived.has(row.id)}
                muted={flags.muted.has(row.id)}
                marked={flags.markedUnread.has(row.id)}
                onMenu={() => setMenuFor(row)}
              />
            ))}
            hits={messageSearch.hits}
            finding={messageSearch.searching}
            query={filter}
            me={myUid}
            labelFor={(chatId) => {
              const row = rows.find((candidate) => candidate.id === chatId);
              return row ? { name: labelOf(row), photoURL: row.self ? myPhoto : row.peer?.photoURL } : null;
            }}
          />
        ) : visible.length === 0 ? (
          <EmptyState searching={searching} archive={showArchived} filter={listFilter} />
        ) : (
          <ul>
            {visible.map((row) => (
              <ChatRow
                key={row.id}
                row={row}
                name={labelOf(row)}
                photoURL={row.self ? myPhoto : row.peer?.photoURL}
                active={pathname === `/chats/${row.id}`}
                typing={typing.has(row.id)}
                draft={drafts[row.id]}
                pinned={flags.pinned.has(row.id) && !flags.archived.has(row.id)}
                muted={flags.muted.has(row.id)}
                marked={flags.markedUnread.has(row.id)}
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
          name={labelOf(menuFor)}
          pinned={flags.pinned.has(menuFor.id)}
          muteStatus={muteLabel(prefs, menuFor.id, now)}
          archived={flags.archived.has(menuFor.id)}
          favourite={flags.favourites.has(menuFor.id)}
          unread={menuFor.unread || flags.markedUnread.has(menuFor.id)}
          // From the prefs, not the loaded rows: a quiet pinned chat past the
          // first page still holds one of the slots.
          pinnedCount={prefs.pinned.filter((id) => !flags.archived.has(id)).length}
          onPin={(on) => toggle('pinned', menuFor.id, on)}
          onMute={(duration) => {
            if (myUid) void setMute(myUid, menuFor.id, duration).catch(() => undefined);
          }}
          onArchive={(on) => toggle('archived', menuFor.id, on)}
          onFavourite={(on) => toggle('favourites', menuFor.id, on)}
          onMarkUnread={(on) => markUnread(menuFor, on)}
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
  name,
  photoURL,
  active,
  typing,
  draft,
  pinned,
  muted,
  marked,
  onMenu,
}: {
  row: ChatListRow;
  /** What to call this chat: see labelOf. */
  name: string;
  photoURL: string | null | undefined;
  active: boolean;
  typing: boolean;
  /** Unsent text on this device. */
  draft?: string;
  pinned: boolean;
  muted: boolean;
  /** Marked unread by hand: a dot, with no count. */
  marked: boolean;
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
        <Avatar name={name} photoURL={photoURL} size={50} />

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate font-semibold">{name}</span>
            <span className={`shrink-0 text-[12px] ${(row.unread || marked) && !muted ? 'text-zing' : 'text-faint'}`}>
              {listTime(row.updatedAt)}
            </span>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className={`truncate text-[14px] ${row.unread ? 'text-ink' : 'text-muted'}`}>
              {typing ? (
                <span className="font-medium text-zing">typing…</span>
              ) : draft ? (
                <>
                  <span className="font-medium text-zing">Draft: </span>
                  {draft.replace(/\s+/g, ' ')}
                </>
              ) : row.preview === null ? (
                row.lastSenderId ? 'Encrypted message' : row.self ? 'Notes, links and reminders to yourself' : 'Say hello'
              ) : (
                plainText(row.preview)
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
              {marked && !row.unread && (
                <span
                  role="img"
                  aria-label="Marked unread"
                  className={`size-3 rounded-full ${muted ? 'bg-faint' : 'bg-zing'}`}
                />
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

/**
 * What a search finds: chats by name, then messages from every chat that
 * this device holds, newest first. The note says where the messages came
 * from, because the server was never asked -- it could not read them anyway.
 */
function SearchResults({
  chats,
  hits,
  finding,
  query,
  me,
  labelFor,
}: {
  chats: React.ReactNode[];
  hits: MessageHit[];
  finding: boolean;
  query: string;
  me: string | undefined;
  labelFor: (chatId: string) => { name: string; photoURL: string | null | undefined } | null;
}) {
  const wantsMessages = normalizeForSearch(query.trim()).length >= 2;
  if (chats.length === 0 && hits.length === 0 && !finding) {
    return (
      <div className="flex flex-col items-center gap-2 px-8 py-16 text-center">
        <p className="text-[15px] text-muted">
          {wantsMessages ? 'No chats or messages match that.' : 'No chats match that.'}
        </p>
        {wantsMessages && (
          <p className="text-[13px] leading-relaxed text-faint">
            Messages are searched on this device, among the ones it has loaded before.
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="pb-24">
      {chats.length > 0 && (
        <>
          <p className="px-4 pt-1 pb-1 text-[12px] font-semibold tracking-wide text-muted uppercase">Chats</p>
          <ul>{chats}</ul>
        </>
      )}
      {wantsMessages && (
        <>
          <p className="px-4 pt-3 pb-1 text-[12px] font-semibold tracking-wide text-muted uppercase">
            Messages{finding ? ' · searching…' : ''}
          </p>
          {hits.length === 0 && !finding ? (
            <p className="px-4 py-3 text-[13px] text-faint">No messages match that.</p>
          ) : (
            <ul aria-label="Messages found">
              {hits.map((hit) => {
                const label = labelFor(hit.chatId);
                const mine = hit.message.senderId === me;
                return (
                  <li key={`${hit.chatId}:${hit.message.id}`}>
                    <Link
                      href={`/chats/${hit.chatId}#m-${hit.message.id}`}
                      className="flex items-start gap-3 px-4 py-2.5 transition-colors hover:bg-surface"
                    >
                      <Avatar name={label?.name ?? '?'} photoURL={label?.photoURL} size={40} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-[14px] font-semibold">{label?.name ?? 'Chat'}</span>
                          <span className="shrink-0 text-[12px] text-faint">{listTime(hit.message.createdAt)}</span>
                        </span>
                        <span className="line-clamp-2 text-[13px] text-muted">
                          {mine && <span className="text-faint">You: </span>}
                          {splitMatches(snippet(hit.message.text ?? '', query), query).map((run, index) =>
                            run.match ? (
                              <mark key={index} className="rounded-sm bg-zing/40 text-ink">
                                {run.text}
                              </mark>
                            ) : (
                              run.text
                            ),
                          )}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="px-4 pt-3 text-[12px] leading-relaxed text-faint">
            Messages are searched on this device only, among the ones it has loaded before.
          </p>
        </>
      )}
    </div>
  );
}

/** The part of a long message around the match, so the match is in view. */
function snippet(text: string, query: string): string {
  const flat = text.replace(/\s+/g, ' ');
  const at = normalizeForSearch(flat).indexOf(normalizeForSearch(query.trim()));
  if (at <= 40) return flat;
  return '…' + flat.slice(at - 30);
}

function EmptyState({
  searching,
  archive,
  filter,
}: {
  searching: boolean;
  archive: boolean;
  filter: ListFilter;
}) {
  const filtered = !searching && !archive && filter !== 'all';
  return (
    <div className="flex flex-col items-center gap-2 px-8 py-16 text-center">
      <p className="text-[15px] text-muted">
        {searching
          ? 'No chats match that.'
          : archive
            ? 'No archived chats.'
            : filter === 'unread'
              ? 'No unread chats.'
              : filter === 'favourites'
                ? 'No favourites yet.'
                : 'No conversations yet.'}
      </p>
      {filter === 'favourites' && filtered && (
        <p className="text-[13px] leading-relaxed text-faint">
          Long-press a chat, or right-click it, and choose Add to favourites.
        </p>
      )}
      {!searching && !archive && !filtered && (
        <p className="text-[13px] leading-relaxed text-faint">
          Tap the pencil to find someone by their @username.
        </p>
      )}
    </div>
  );
}
