'use client';

import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/store/session';
import { useThread } from '@/lib/hooks/useThread';
import { dayLabel, lastSeenLabel } from '@/lib/format';
import { Avatar } from '@/components/ui/Avatar';
import { Spinner } from '@/components/ui/Spinner';
import { MessageBubble, type Quote } from '@/components/chat/MessageBubble';
import { MessageMenu } from '@/components/chat/MessageMenu';
import { Composer, type ComposerContext } from '@/components/chat/Composer';
import { TypingBubble, TypingDots } from '@/components/chat/TypingDots';
import { tickState } from '@/components/chat/Ticks';
import { ChatInfoSheet } from '@/components/chat/ChatInfoSheet';
import { ForwardSheet } from '@/components/chat/ForwardSheet';
import type { DecryptedMessage } from '@/lib/db/schema';
import { clearChatNotifications } from '@/lib/push';
import { acceptPeerKey, peerKeyChanged } from '@/lib/keyWatch';
import { findMatches } from '@/lib/search';
import { summarizeReactions } from '@/lib/reactions';
import { draftFor, useDrafts } from '@/lib/store/drafts';
import { MessageInfoSheet } from '@/components/chat/MessageInfoSheet';
import { DisappearingIcon, disappearingLabel } from '@/components/chat/Disappearing';
import { ChatMenu } from '@/components/chat/ChatMenu';
import { useChatPrefs } from '@/lib/hooks/useChatPrefs';
import { useMuteClock } from '@/lib/hooks/useMuteClock';
import { useAccount, useMyPhoto, useNicknames } from '@/lib/store/account';
import { nameFor } from '@/lib/names';
import { isSelfChat, peerOf } from '@/lib/chatIds';
import { VIEW_ONCE_LABEL } from '@/lib/viewOnce';
import { PinnedBar } from '@/components/chat/PinnedBar';
import { ViewOnceSheet } from '@/components/chat/ViewOnceSheet';
import { AttachSheet } from '@/components/chat/AttachSheet';
import { coordinates, encodeLocation, parseLocation } from '@/lib/location';
import { collectForExport, download, exportAsJson, exportAsText, exportFilename, type ExportFormat } from '@/lib/export';
import { loadAllMessages, hasExpired } from '@/lib/db/messages';
import { isHidden } from '@/lib/hidden';
import { DeleteSelectionSheet, SelectionBar } from '@/components/chat/SelectionBar';
import { bubbleTime } from '@/lib/format';
import { plainText } from '@/lib/formatting';
import { canTranslate, translateMessage, type Translation } from '@/lib/translate';
import { setChatPref, setChatTheme, setMute, setNickname } from '@/lib/db/prefs';
import { muteLabel } from '@/lib/mute';

export default function ThreadPage({ params }: { params: Promise<{ chatId: string }> }) {
  const { chatId } = use(params);
  const { user, profile } = useSession();
  const router = useRouter();
  const [infoOpen, setInfoOpen] = useState(false);
  // The ⋮ menu: everything that acts on the chat as a whole.
  const [chatMenuOpen, setChatMenuOpen] = useState(false);
  const [menuFor, setMenuFor] = useState<DecryptedMessage | null>(null);
  const [forwarding, setForwarding] = useState<DecryptedMessage | null>(null);
  const [infoFor, setInfoFor] = useState<DecryptedMessage | null>(null);
  const [composerContext, setComposerContext] = useState<ComposerContext>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  // In-chat search: null when closed. Runs over plaintext already on this
  // device -- the server could not search ciphertext even if asked.
  const [search, setSearch] = useState<string | null>(null);
  const [hit, setHit] = useState(0);
  // A view-once message of theirs, open: the text as it was when opened.
  const [viewing, setViewing] = useState<{ id: string; text: string } | null>(null);
  // Several messages picked at once (WhatsApp's "Select"); null when not.
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [deletingSelection, setDeletingSelection] = useState(false);
  const [forwardingMany, setForwardingMany] = useState<DecryptedMessage[] | null>(null);
  // Opened from a notification's "Reply" (lib/sw.js): the keyboard comes up
  // in the box. The flag is taken off the address so a reload does not repeat it.
  const [replying] = useState(
    () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('reply') === '1',
  );
  useEffect(() => {
    if (replying) window.history.replaceState(null, '', window.location.pathname + window.location.hash);
  }, [replying]);

  const [attaching, setAttaching] = useState(false);

  /**
   * The whole chat as a file (lib/export.ts): read and decrypted here, without
   * what I deleted for myself, cleared, or what has expired.
   */
  async function exportChat(format: ExportFormat, onProgress: (count: number) => void) {
    if (!conversationKey) return false;
    const everything = await collectForExport(`${user?.uid}:${chatId}`, () =>
      loadAllMessages(chatId, conversationKey, { after: hiddenList.clearedAt, onProgress }),
    );
    const kept = everything.filter((message) => !isHidden(message, hiddenList) && !hasExpired(message));
    const title = selfChat ? 'Message yourself' : exportName;
    // Plain names, not the profile: the file needs only who said what.
    const author = (message: DecryptedMessage) => (message.senderId === user?.uid ? 'You' : exportName);
    const file = format === 'json' ? exportAsJson(kept, author, title) : exportAsText(kept, author, title);
    download(file, exportFilename(title, format), format === 'json' ? 'application/json' : 'text/plain');
    return true;
  }

  // Messages translated on this device, by id. Kept only while the chat is open.
  const [translations, setTranslations] = useState<Record<string, Translation>>({});

  async function translate(message: DecryptedMessage) {
    if (message.text === null) return;
    setTranslations((current) => ({ ...current, [message.id]: { state: 'working' } }));
    const result = await translateMessage(message.text);
    setTranslations((current) => ({ ...current, [message.id]: result }));
  }
  // A pinned message older than the loaded pages: load back until it shows.
  const [pendingJump, setPendingJump] = useState<{ id: string } | null>(null);

  // Direct chat ids are the two uids sorted and joined, so the peer is
  // derivable without a lookup. "Message yourself" has none.
  const peerUid = useMemo(() => peerOf(chatId, user?.uid), [chatId, user]);
  const selfChat = isSelfChat(chatId, user?.uid);
  const myPhoto = useMyPhoto(profile?.photoURL);

  const {
    messages,
    peer,
    peerDeleted,
    unavailable,
    blockedByMe,
    blockedByPeer,
    setBlock,
    disappearing,
    chatKnown,
    setDisappearing,
    presence,
    peerTyping,
    loading,
    conversationKey,
    sendText,
    editText,
    deleteForEveryone,
    deleteForMe,
    clearChat,
    hiddenList,
    openViewOnce,
    pinned,
    pinnedIds,
    togglePin,
    react,
    starredIds,
    toggleStar,
    forward,
    retry,
    discard,
    notice,
    ping,
    loadOlder,
    exhausted,
    peerReadAt,
    peerDeliveredAt,
  } = useThread(chatId, peerUid);

  // This user's own settings for the chat, from the one account listener.
  const prefs = useChatPrefs(user?.uid);
  const muteNow = useMuteClock(prefs);
  const chatTheme = useAccount((state) => state.settings.chatThemes[chatId]) ?? NO_THEME;
  const defaultWallpaper = useAccount((state) => state.settings.appearance.wallpaper);
  // My nickname for them, if I gave one; their own name otherwise.
  const nicknames = useNicknames();
  const peerName = selfChat
    ? `${profile?.displayName ?? 'Me'} (You)`
    : nameFor(peer, nicknames, peerDeleted ? 'Deleted account' : 'Loading');
  // The other person's name as plain text, for an exported file.
  const exportName = nameFor(peer, nicknames, peerDeleted ? 'Deleted account' : 'Them');

  // Opening a chat marked unread by hand takes the mark off, as on WhatsApp.
  const markedUnread = prefs.markedUnread.includes(chatId);
  useEffect(() => {
    if (user && markedUnread) void setChatPref(user.uid, 'markedUnread', chatId, false).catch(() => undefined);
  }, [user, markedUnread, chatId]);

  // Unsent text survives leaving the chat, on this device only.
  const uid = user?.uid;
  const saveDraft = useDrafts((state) => state.set);
  // Read when the chat changes; the composer only takes it as it mounts.
  const initialDraft = useMemo(() => (uid ? draftFor(uid, chatId) : ''), [uid, chatId]);
  const onDraftChange = useCallback(
    (text: string) => {
      if (uid) saveDraft(uid, chatId, text);
    },
    [uid, chatId, saveDraft],
  );

  // Counted from the newest, like WhatsApp: hit 0 is the latest match.
  const matches = useMemo(() => (search ? findMatches(messages, search) : []), [messages, search]);

  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const pinning = useRef(false);
  // Scrolled up reading history: shows the jump-to-latest button, with a
  // count of messages that arrived meanwhile.
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const [unseen, setUnseen] = useState(0);

  function scrollToBottom(smooth = false) {
    const node = scroller.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    atBottom.current = true;
    // A smooth scroll fires scroll events on its way down; until it lands,
    // those must not mark the reader as "scrolled up", or a second message
    // arriving mid-scroll would not be followed.
    // Released on landing, on the reader's own touch or wheel (which cancels
    // a smooth scroll), or after a second at most.
    if (smooth) {
      pinning.current = true;
      setTimeout(() => (pinning.current = false), 1000);
    }
    setAwayFromBottom(false);
    setUnseen(0);
  }

  // Keyed on the newest message, not the count: the live window holds the
  // newest page, so past that size a new message pushes the oldest out and
  // the count never changes -- which is what stopped the autoscroll.
  const newest = messages.at(-1);
  const newestId = newest?.id;
  const newestMine = newest?.senderId === user?.uid;
  const seenNewest = useRef<string | undefined>(undefined);
  // When the newest seen was sent: a newest that changes because the last
  // one went (deleted for me, expired) is older, and is not "new".
  const newestAt = newest?.createdAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const seenNewestAt = useRef(0);

  // Follow new messages only when the reader is already at the bottom --
  // yanking someone out of history they are scrolled up reading is worse than
  // missing an autoscroll. Otherwise count them on the jump button.
  useEffect(() => {
    const isNew =
      newestId !== undefined && newestId !== seenNewest.current && newestAt > seenNewestAt.current;
    const firstLoad = seenNewest.current === undefined;
    seenNewest.current = newestId;
    seenNewestAt.current = Math.max(seenNewestAt.current, newestAt === Number.MAX_SAFE_INTEGER ? 0 : newestAt);

    if (atBottom.current || firstLoad) {
      requestAnimationFrame(() => scrollToBottom(!firstLoad));
    } else if (isNew && !newestMine) {
      setUnseen((count) => count + 1);
    }
    // newestAt moves with newestId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newestId, newestMine, peerTyping]);

  // Opening a chat dismisses its notifications, as WhatsApp does.
  useEffect(() => {
    void clearChatNotifications(chatId);
  }, [chatId]);

  // The keyboard or emoji panel opening shrinks the list from below without
  // moving its scroll position, which would slide the newest messages out of
  // sight behind the composer. Stay pinned if the reader was at the bottom.
  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const observer = new ResizeObserver(() => {
      if (atBottom.current) node.scrollTo({ top: node.scrollHeight });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Their public key, checked against the one this device saw before. The
  // check records a first-seen key, so it is keyed on the profile alone.
  const keyChanged = useMemo(
    () => (peer ? peerKeyChanged(peer.uid, peer.publicKey) : false),
    [peer],
  );
  const [acceptedKey, setAcceptedKey] = useState<string | null>(null);

  const groups = useMemo(() => groupByDay(messages), [messages]);
  const byId = useMemo(() => new Map(messages.map((message) => [message.id, message])), [messages]);

  const authorOf = (message: DecryptedMessage) =>
    message.senderId === user?.uid ? 'You' : nameFor(peer, nicknames, 'Them');

  // Quotes are rendered from plaintext already decrypted on this device; the
  // message itself stores only the id it replies to.
  function quoteFor(message: DecryptedMessage): Quote | null {
    if (!message.replyTo) return null;
    const original = byId.get(message.replyTo);
    if (!original) return { author: '', text: null, deleted: false };
    return {
      author: authorOf(original),
      text: original.viewOnce ? VIEW_ONCE_LABEL : original.text,
      deleted: original.deleted,
    };
  }

  function replyTo(message: DecryptedMessage) {
    setComposerContext({
      kind: 'reply',
      id: message.id,
      author: authorOf(message),
      text: message.viewOnce ? VIEW_ONCE_LABEL : message.text,
    });
  }

  function jumpTo(id: string) {
    const node = document.getElementById(`m-${id}`);
    if (!node) return;
    atBottom.current = false;
    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlighted(id);
    setTimeout(() => setHighlighted((current) => (current === id ? null : current)), 1200);
  }

  // A pinned message may be older than what is loaded: page back until it
  // is on screen, then jump; give up quietly at the start of the chat.
  //
  // Keyed on the oldest loaded message, not the list: a page that brings
  // nothing older (offline, cache only) leaves it alone, so this waits for the
  // next tap instead of asking again on every render, forever.
  const jumpTarget = pendingJump?.id ?? null;
  const jumpFound = jumpTarget !== null && messages.some((message) => message.id === jumpTarget);
  const oldestId = messages[0]?.id;
  useEffect(() => {
    if (!jumpTarget) return;
    if (!jumpFound && !exhausted) {
      void loadOlder();
      return;
    }
    // Next frame: the message is rendered by then, and the state change is
    // not made in the middle of this render's effects.
    const frame = requestAnimationFrame(() => {
      setPendingJump(null);
      if (jumpFound) jumpTo(jumpTarget);
    });
    return () => cancelAnimationFrame(frame);
    // loadOlder changes with every page; following it would re-ask each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingJump, jumpFound, oldestId, exhausted]);

  function jumpToMessage(id: string) {
    if (document.getElementById(`m-${id}`)) jumpTo(id);
    // A new object each tap, so tapping again retries after a stalled load.
    else setPendingJump({ id });
  }

  // Arriving from the Starred screen: /chats/{id}#m-{messageId}. Once, as
  // soon as that message is on screen; one older than the loaded pages just
  // opens the chat.
  // A message older than the loaded pages (a search hit from weeks ago) is
  // paged back to, the way a pinned message is.
  const arrivedAt = useRef<string | null>(null);
  useEffect(() => {
    const target = window.location.hash.startsWith('#m-') ? window.location.hash.slice(3) : null;
    if (!target || arrivedAt.current === target || loading) return;
    arrivedAt.current = target;
    if (messages.some((message) => message.id === target)) requestAnimationFrame(() => jumpTo(target));
    else requestAnimationFrame(() => setPendingJump({ id: target }));
  }, [messages, loading]);

  /**
   * Step to a search hit (0 is the newest) and bring it into view. Done here,
   * where the step happens, so new messages arriving mid-search never move
   * the view on their own.
   */
  function goToHit(next: number, found = matches) {
    if (!found.length) {
      setHit(0);
      return;
    }
    const index = (next + found.length) % found.length;
    setHit(index);
    jumpTo(found[found.length - 1 - index]);
  }

  function closeSearch() {
    setSearch(null);
    setHit(0);
  }

  function handleSend(text: string, options: { viewOnce: boolean } = { viewOnce: false }) {
    const context = composerContext;
    setComposerContext(null);

    if (context?.kind === 'edit') {
      if (text !== context.text) editText(context.id, text);
      return;
    }
    atBottom.current = true;
    return sendText(text, context?.kind === 'reply' ? context.id : null, false, options.viewOnce);
  }

  // The selection as it is now, oldest first. A message that went meanwhile
  // (deleted, expired) simply drops out of it.
  const selectedMessages = selected
    ? messages.filter((message) => selected.has(message.id) && !message.failed)
    : [];
  const selecting = selected !== null && selectedMessages.length > 0;
  const allHaveText = selectedMessages.every(
    (message) => message.text !== null && !message.deleted && !message.viewOnce,
  );
  const allStarrable = selectedMessages.every(
    (message) => !message.deleted && !message.pending && !message.viewOnce,
  );

  function toggleSelected(id: string) {
    setSelected((current) => {
      const next = new Set(current ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next.size ? next : null;
    });
  }

  // Esc leaves selecting, as Back does on a phone.
  useEffect(() => {
    if (!selecting) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setSelected(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selecting]);

  /** One message as it is; several as "[time] Name: text" lines, like WhatsApp. */
  async function copySelection(): Promise<boolean> {
    const text =
      selectedMessages.length === 1
        ? (() => {
            const location = parseLocation(selectedMessages[0].text);
            return location ? coordinates(location) : (selectedMessages[0].text ?? '');
          })()
        : selectedMessages
            .map((message) => {
              const location = parseLocation(message.text);
              return `[${message.createdAt ? bubbleTime(message.createdAt) : ''}] ${authorOf(message)}: ${location ? coordinates(location) : (message.text ?? '')}`;
            })
            .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  // Dialogs follow the message as it is now. One deleted for everyone, or
  // expired, while its menu is open must not still be copied, forwarded or
  // edited from the copy taken when the menu opened.
  const menuMessage = menuFor ? (byId.get(menuFor.id) ?? null) : null;
  const infoMessage = infoFor ? byId.get(infoFor.id) : undefined;
  const forwardMessage = forwarding ? byId.get(forwarding.id) : undefined;

  return (
    // A bubble colour of this chat's own, if it has one (app/globals.css).
    <div className="flex h-dvh flex-col bg-void" data-bubble={chatTheme.bubble}>
      {search !== null ? (
        <header className="flex items-center gap-1 border-b border-line bg-surface px-2 pt-safe">
          <button
            onClick={closeSearch}
            aria-label="Close search"
            className="grid size-10 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-elevated"
          >
            <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
              <path d="M15 5 8 12l7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <input
            autoFocus
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              goToHit(0, findMatches(messages, event.target.value));
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') closeSearch();
              // Enter steps to the next (older) hit, Shift+Enter back.
              if (event.key === 'Enter' && matches.length) {
                event.preventDefault();
                goToHit(hit + (event.shiftKey ? -1 : 1));
              }
            }}
            placeholder="Search this chat"
            aria-label="Search this chat"
            className="h-14 min-w-0 flex-1 bg-transparent px-1 text-[16px] text-ink placeholder:text-faint focus:outline-none"
          />
          {search.trim() && (
            <span className="shrink-0 text-[13px] text-muted tabular-nums" aria-live="polite">
              {matches.length ? `${Math.min(hit, matches.length - 1) + 1} of ${matches.length}` : 'No results'}
            </span>
          )}
          <button
            onClick={() => goToHit(hit + 1)}
            disabled={matches.length < 2}
            aria-label="Older match"
            className="grid size-10 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-elevated disabled:opacity-40"
          >
            <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
              <path d="m6 15 6-6 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            onClick={() => goToHit(hit - 1)}
            disabled={matches.length < 2}
            aria-label="Newer match"
            className="grid size-10 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-elevated disabled:opacity-40"
          >
            <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
              <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </header>
      ) : selecting ? (
        <SelectionBar
          count={selectedMessages.length}
          canReply={selectedMessages.length === 1 && !selectedMessages[0].deleted && !blockedByMe}
          canStar={allStarrable}
          allStarred={selectedMessages.every((message) => starredIds.has(message.id))}
          canCopy={allHaveText}
          canForward={allHaveText}
          onReply={() => {
            replyTo(selectedMessages[0]);
            setSelected(null);
          }}
          onStar={(on) => {
            toggleStar(
              selectedMessages.map((message) => message.id),
              on,
            );
            setSelected(null);
          }}
          onCopy={async () => {
            const ok = await copySelection();
            if (ok) setTimeout(() => setSelected(null), 600);
            return ok;
          }}
          onForward={() => setForwardingMany(selectedMessages)}
          onDelete={() => setDeletingSelection(true)}
          onCancel={() => setSelected(null)}
        />
      ) : (
      <header className="flex items-center gap-3 border-b border-line bg-surface px-2 pt-safe">
        <Link
          href="/chats"
          aria-label="Back"
          className="grid size-10 place-items-center rounded-full text-muted
            transition-colors hover:bg-elevated md:hidden"
        >
          <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
            <path
              d="M15 5 8 12l7 7"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Link>

        <button
          // A chat with myself has no profile to show; its menu has the rest.
          onClick={() => (selfChat ? setChatMenuOpen(true) : peer && setInfoOpen(true))}
          className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-1 text-left"
        >
          <Avatar
            name={peerName}
            photoURL={selfChat ? myPhoto : peer?.photoURL}
            size={40}
            online={presence.online}
          />
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 truncate font-semibold">
              <span className="truncate">{peerName}</span>
              {disappearing > 0 && (
                <DisappearingIcon className="size-3.5 shrink-0 text-muted" label={disappearingLabel(disappearing)} />
              )}
            </p>
            <p className="flex items-center gap-1.5 truncate text-[12px] text-muted">
              {selfChat ? (
                'Message yourself'
              ) : peerTyping ? (
                <>
                  <TypingDots />
                  <span className="text-zing">typing…</span>
                </>
              ) : (
                lastSeenLabel(presence)
              )}
            </p>
          </div>
        </button>

        <button
          onClick={() => setSearch('')}
          aria-label="Search this chat"
          className="grid size-10 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-elevated hover:text-ink"
        >
          <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.9" />
            <path d="m16 16 4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
          </svg>
        </button>

        <button
          onClick={() => setChatMenuOpen(true)}
          aria-label="Chat options"
          aria-haspopup="dialog"
          className="mr-1 grid size-10 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-elevated hover:text-ink"
        >
          <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
            <circle cx="12" cy="5.5" r="1.7" fill="currentColor" />
            <circle cx="12" cy="12" r="1.7" fill="currentColor" />
            <circle cx="12" cy="18.5" r="1.7" fill="currentColor" />
          </svg>
        </button>
      </header>
      )}

      {search === null && <PinnedBar key={`pins-${chatId}`} pinned={pinned} onJump={jumpToMessage} />}

      {search !== null && search.trim() && !exhausted && (
        <div className="flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-1.5 text-[12px] text-faint">
          <span>Searching the messages loaded on this device.</span>
          <button onClick={() => void loadOlder()} className="shrink-0 font-medium text-zing">
            Load older
          </button>
        </div>
      )}

      {keyChanged && peer && acceptedKey !== peer.publicKey && (
        <div className="flex items-start gap-3 border-b border-line bg-surface px-4 py-3">
          <p className="flex-1 text-[13px] leading-relaxed text-muted">
            <span className="font-medium text-ink">{peerName}&apos;s security key changed.</span>{' '}
            That should never happen on Zing. Verify encryption with them before sending anything
            sensitive.
          </p>
          <div className="flex shrink-0 gap-1">
            <button
              onClick={() => peer && setInfoOpen(true)}
              className="h-8 rounded-full px-3 text-[13px] font-medium text-zing"
            >
              Verify
            </button>
            <button
              onClick={() => {
                acceptPeerKey(peer.uid, peer.publicKey);
                setAcceptedKey(peer.publicKey);
              }}
              className="h-8 rounded-full px-3 text-[13px] text-muted"
            >
              OK
            </button>
          </div>
        </div>
      )}

      {disappearing > 0 && (
        <button
          onClick={() => (peer ? setInfoOpen(true) : setChatMenuOpen(true))}
          className="flex items-center justify-center gap-1.5 border-b border-line bg-surface px-4 py-1.5 text-[12px] text-muted"
        >
          <DisappearingIcon className="size-3.5 shrink-0" />
          New messages disappear {disappearingLabel(disappearing)} after they&apos;re sent.
        </button>
      )}

      <div
        ref={scroller}
        onWheel={() => (pinning.current = false)}
        onTouchStart={() => (pinning.current = false)}
        onScroll={(event) => {
          const node = event.currentTarget;
          const fromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
          if (pinning.current) {
            if (fromBottom < 80) pinning.current = false;
            return;
          }
          atBottom.current = fromBottom < 80;
          setAwayFromBottom(fromBottom > 300);
          if (atBottom.current) setUnseen(0);
          if (node.scrollTop < 120 && !exhausted) void loadOlder();
        }}
        // overflow-x-hidden: a bubble dragged for swipe-to-reply must not
        // widen the scroller.
        className="chat-wallpaper min-h-0 flex-1 space-y-1 overflow-x-hidden overflow-y-auto px-3 py-3 scroll-thin"
        // This chat's own wallpaper, or the one from Settings.
        data-wallpaper={chatTheme.wallpaper ?? defaultWallpaper}
      >
        {unavailable ? (
          <p className="px-10 py-16 text-center text-[14px] text-muted">
            This chat isn&apos;t available. The link may be wrong, or the conversation isn&apos;t yours.
          </p>
        ) : loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-muted">
            <Spinner />
            <span className="text-sm">Decrypting</span>
          </div>
        ) : messages.length === 0 ? (
          <FirstMessageHint name={nameFor(peer, nicknames, 'them')} self={selfChat} />
        ) : (
          groups.map((group) => (
            <section key={group.messages[0].id} className="space-y-1">
              <div className="sticky top-0 z-10 flex justify-center py-2">
                <span className="rounded-full bg-elevated/90 px-3 py-1 text-[11px] text-muted backdrop-blur">
                  {group.label}
                </span>
              </div>

              {group.messages.map((message, index) => {
                const mine = message.senderId === user?.uid;
                const next = group.messages[index + 1];

                return (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    mine={mine}
                    tailed={!next || next.senderId !== message.senderId}
                    quote={quoteFor(message)}
                    highlighted={highlighted === message.id}
                    reactions={summarizeReactions(message.reactions, user?.uid)}
                    starred={starredIds.has(message.id)}
                    search={search ?? ''}
                    onReply={() => replyTo(message)}
                    onMenu={() => setMenuFor(message)}
                    onQuoteClick={() => message.replyTo && jumpTo(message.replyTo)}
                    onReactionClick={() => {
                      if (user && message.reactions?.[user.uid]) react(message.id, null);
                      else setMenuFor(message);
                    }}
                    onRetry={() => retry(message.id)}
                    onDiscard={() => discard(message.id)}
                    onOpenViewOnce={() =>
                      message.text !== null && setViewing({ id: message.id, text: message.text })
                    }
                    translation={translations[message.id]}
                    onHideTranslation={() =>
                      setTranslations((current) => {
                        const next = { ...current };
                        delete next[message.id];
                        return next;
                      })
                    }
                    selecting={selecting}
                    selected={selected?.has(message.id) ?? false}
                    onToggleSelect={() => toggleSelected(message.id)}
                    tick={
                      // Nobody else to deliver to: kept is as far as it goes.
                      selfChat
                        ? message.pending || !message.createdAt
                          ? 'pending'
                          : 'delivered'
                        : tickState({
                            pending: message.pending,
                            createdAt: message.createdAt,
                            peerDeliveredAt,
                            peerReadAt,
                          })
                    }
                  />
                );
              })}
            </section>
          ))
        )}

        {peerTyping && !loading && <TypingBubble />}
      </div>

      {(awayFromBottom || unseen > 0) && (
        <div className="relative">
          <button
            onClick={() => scrollToBottom(true)}
            aria-label={unseen > 0 ? `${unseen} new messages, jump to latest` : 'Jump to latest'}
            className="absolute right-4 bottom-3 z-20 grid size-10 place-items-center rounded-full
              border border-line bg-elevated text-muted shadow-lg shadow-black/40
              transition-colors hover:text-ink"
          >
            <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
              <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {unseen > 0 && (
              <span className="absolute -top-2 -right-1 grid h-5 min-w-5 place-items-center rounded-full bg-zing px-1.5 text-[11px] font-semibold text-on-zing">
                {unseen > 99 ? '99+' : unseen}
              </span>
            )}
          </button>
        </div>
      )}

      {notice && (
        <p role="status" className="bg-surface px-4 pt-2 text-center text-[13px] text-danger">
          {notice}
        </p>
      )}

      {blockedByMe ? (
        <div className="flex items-center justify-center gap-3 border-t border-line bg-surface px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <p className="text-[13px] text-muted">You blocked {nameFor(peer, nicknames, 'this person')}.</p>
          <button
            onClick={() => setBlock(false)}
            className="h-9 rounded-full bg-elevated px-4 text-[13px] font-medium text-zing"
          >
            Unblock
          </button>
        </div>
      ) : (
        <Composer
          key={chatId}
          draft={initialDraft}
          onDraftChange={onDraftChange}
          onSend={handleSend}
          allowViewOnce={!selfChat}
          autoFocus={replying}
          onAttach={() => setAttaching(true)}
          onTyping={ping}
          disabled={peerDeleted || blockedByPeer || unavailable || !conversationKey || !chatKnown}
          disabledText={
            unavailable
              ? "Can’t send here"
              : peerDeleted
              ? 'This account was deleted'
              : blockedByPeer
                ? 'You can’t send messages in this chat'
                : undefined
          }
          context={composerContext}
          onCancelContext={() => setComposerContext(null)}
        />
      )}

      {menuMessage && (
        <MessageMenu
          message={menuMessage}
          mine={menuMessage.senderId === user?.uid}
          myReaction={(user && menuMessage.reactions?.[user.uid]) || null}
          starred={starredIds.has(menuMessage.id)}
          pinned={pinnedIds.includes(menuMessage.id)}
          // The rules keep a blocked chat frozen, pins included.
          onPin={
            blockedByMe || blockedByPeer || !conversationKey
              ? undefined
              : (on) => togglePin(menuMessage.id, on)
          }
          canInfo={!selfChat}
          selfChat={selfChat}
          onSelect={() => setSelected(new Set([menuMessage.id]))}
          onTranslate={canTranslate() ? () => void translate(menuMessage) : undefined}
          canReact={conversationKey !== null && !peerDeleted && !blockedByMe && !blockedByPeer}
          onReply={() => replyTo(menuMessage)}
          onEdit={() =>
            menuMessage.text !== null &&
            setComposerContext({ kind: 'edit', id: menuMessage.id, text: menuMessage.text })
          }
          onDelete={() => deleteForEveryone(menuMessage.id)}
          onDeleteForMe={() => deleteForMe(menuMessage.id)}
          onReact={(emoji) => react(menuMessage.id, emoji)}
          onStar={(on) => toggleStar(menuMessage.id, on)}
          onForward={() => setForwarding(menuMessage)}
          onInfo={() => setInfoFor(menuMessage)}
          onClose={() => setMenuFor(null)}
        />
      )}

      {infoMessage && !infoMessage.deleted && (
        <MessageInfoSheet
          message={infoMessage}
          peerName={nameFor(peer, nicknames, 'They')}
          peerDeliveredAt={peerDeliveredAt}
          peerReadAt={peerReadAt}
          onClose={() => setInfoFor(null)}
        />
      )}

      {forwardMessage?.text && !forwardMessage.deleted && user && (
        <ForwardSheet
          me={user.uid}
          preview={plainText(forwardMessage.text)}
          onClose={() => setForwarding(null)}
          onPick={async (target) => {
            const ok = await forward(forwardMessage.text!, target);
            if (ok) {
              setForwarding(null);
              if (target !== chatId) router.push(`/chats/${target}`);
            }
            return ok;
          }}
        />
      )}

      {deletingSelection && selecting && (
        <DeleteSelectionSheet
          count={selectedMessages.length}
          forEveryone={selectedMessages.every(
            (message) => message.senderId === user?.uid && !message.deleted,
          )}
          selfChat={selfChat}
          onDeleteForEveryone={() => {
            selectedMessages.forEach((message) => deleteForEveryone(message.id));
            setSelected(null);
          }}
          onDeleteForMe={() => {
            deleteForMe(selectedMessages.map((message) => message.id));
            setSelected(null);
          }}
          onClose={() => setDeletingSelection(false)}
        />
      )}

      {forwardingMany && user && (
        <ForwardSheet
          me={user.uid}
          preview={
            forwardingMany.length === 1
              ? (forwardingMany[0].text ?? '')
              : `${forwardingMany.length} messages: ${forwardingMany.map((message) => plainText(message.text ?? '')).join(' · ')}`
          }
          onClose={() => setForwardingMany(null)}
          onPick={async (target) => {
            // In the order they were sent, each sealed afresh for that chat.
            for (const message of forwardingMany) {
              if (message.text === null) continue;
              if (!(await forward(message.text, target))) return false;
            }
            setForwardingMany(null);
            setSelected(null);
            if (target !== chatId) router.push(`/chats/${target}`);
            return true;
          }}
        />
      )}

      {attaching && (
        <AttachSheet
          onSendLocation={(location) => {
            atBottom.current = true;
            const reply = composerContext?.kind === 'reply' ? composerContext.id : null;
            if (reply) setComposerContext(null);
            void sendText(encodeLocation(location), reply);
          }}
          onClose={() => setAttaching(false)}
        />
      )}

      {viewing && (
        <ViewOnceSheet
          text={viewing.text}
          from={nameFor(peer, nicknames, 'them')}
          viewer={profile ? `@${profile.username}` : 'Zing'}
          onOpened={() => openViewOnce(viewing.id)}
          onClose={() => setViewing(null)}
        />
      )}

      {infoOpen && peer && (
        <ChatInfoSheet
          peer={peer}
          nickname={nicknames[peer.uid] ?? null}
          onNickname={(name) => void setNickname(user!.uid, peer.uid, name).catch(() => undefined)}
          presence={presence}
          blocked={blockedByMe}
          onBlock={setBlock}
          disappearing={disappearing}
          // Can't change it across a block: the rules keep the chat frozen.
          onDisappearing={blockedByMe || blockedByPeer ? undefined : setDisappearing}
          onClose={() => setInfoOpen(false)}
        />
      )}

      {chatMenuOpen && user && (
        <ChatMenu
          name={selfChat ? 'Message yourself' : nameFor(peer, nicknames, peerDeleted ? 'Deleted account' : 'Chat')}
          canBlock={Boolean(peer) && !peerDeleted}
          // Nothing in a chat with myself ever sends a push.
          canMute={!selfChat}
          selfChat={selfChat}
          blocked={blockedByMe}
          muteStatus={muteLabel(prefs, chatId, muteNow)}
          disappearing={disappearing}
          theme={chatTheme}
          defaultWallpaper={defaultWallpaper}
          pinned={prefs.pinned.includes(chatId)}
          pinnedCount={prefs.pinned.filter((id) => !prefs.archived.includes(id)).length}
          favourite={prefs.favourites.includes(chatId)}
          archived={prefs.archived.includes(chatId)}
          onContactInfo={peer ? () => setInfoOpen(true) : undefined}
          onMute={(duration) => void setMute(user.uid, chatId, duration).catch(() => undefined)}
          // Can't change it across a block: the rules keep the chat frozen.
          onDisappearing={blockedByMe || blockedByPeer ? undefined : setDisappearing}
          onTheme={(patch) => void setChatTheme(user.uid, chatId, patch).catch(() => undefined)}
          onPin={(on) => void setChatPref(user.uid, 'pinned', chatId, on).catch(() => undefined)}
          onFavourite={(on) =>
            void setChatPref(user.uid, 'favourites', chatId, on).catch(() => undefined)
          }
          onArchive={(on) => void setChatPref(user.uid, 'archived', chatId, on).catch(() => undefined)}
          onBlock={setBlock}
          onClear={() => {
            clearChat();
            setComposerContext(null);
          }}
          onExport={conversationKey ? exportChat : undefined}
          onCloseChat={() => router.push('/chats')}
          onClose={() => setChatMenuOpen(false)}
        />
      )}
    </div>
  );
}

const NO_THEME = {};

function FirstMessageHint({ name, self }: { name: string; self: boolean }) {
  if (self) {
    return (
      <div className="flex flex-col items-center gap-2 px-10 py-16 text-center">
        <svg viewBox="0 0 24 24" className="size-8 text-zing/60" aria-hidden="true">
          <path d="M5 4h11l3 3v13H5zM9 9h6M9 13h6M9 17h3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
        <p className="text-[14px] text-muted">Message yourself</p>
        <p className="text-[12px] leading-relaxed text-faint">
          Notes, links and reminders, encrypted with a key only you hold. They follow you to every
          device you sign in on.
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-2 px-10 py-16 text-center">
      <svg viewBox="0 0 24 24" className="size-8 text-zing/60" aria-hidden="true">
        <path
          d="M6 10V7a6 6 0 0 1 12 0v3m-14 0h16v11H4z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        />
      </svg>
      <p className="text-[14px] text-muted">This is the start of your chat with {name}.</p>
      <p className="text-[12px] leading-relaxed text-faint">
        Messages here are encrypted on your device with a key only the two of you hold.
      </p>
    </div>
  );
}

function groupByDay(messages: DecryptedMessage[]) {
  const groups: { label: string; messages: DecryptedMessage[] }[] = [];

  for (const message of messages) {
    const label = message.createdAt ? dayLabel(message.createdAt) : 'Today';
    const current = groups.at(-1);

    if (current?.label === label) current.messages.push(message);
    else groups.push({ label, messages: [message] });
  }

  return groups;
}
