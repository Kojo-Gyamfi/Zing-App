'use client';

import { useMemo, useState } from 'react';
import { useChats } from '@/lib/store/chats';
import { useProfiles } from '@/lib/store/profiles';
import { Avatar } from '@/components/ui/Avatar';
import { Spinner } from '@/components/ui/Spinner';

/**
 * Pick a chat to forward a message into. The candidates are the chats the
 * list already has loaded (lib/store/chats.ts) with the profiles it already
 * cached, so opening this costs no reads. Chats with a deleted account are
 * left out: nobody is there to receive it.
 */
export function ForwardSheet({
  me,
  preview,
  onPick,
  onClose,
}: {
  me: string;
  /** The text being forwarded, shown so the person knows what is going. */
  preview: string;
  /** Resolves false when that chat cannot take it yet. */
  onPick: (chatId: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const chats = useChats((state) => (state.owner === me ? state.chats : null));
  const profiles = useProfiles((state) => state.profiles);
  const missing = useProfiles((state) => state.missing);
  const [filter, setFilter] = useState('');
  const [sending, setSending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return Object.values(chats ?? {})
      .map((chat) => {
        const peerUid = chat.members.find((member) => member !== me) ?? null;
        return { chat, peer: peerUid ? profiles[peerUid] : undefined, gone: peerUid ? missing[peerUid] : false };
      })
      // A blocked chat would refuse the message.
      .filter((row) => row.peer && !row.gone && Object.keys(row.chat.blocked ?? {}).length === 0)
      .filter(
        (row) =>
          !needle ||
          row.peer!.displayName.toLowerCase().includes(needle) ||
          row.peer!.username.includes(needle),
      )
      .sort(
        (a, b) =>
          (b.chat.updatedAt?.toDate?.().getTime() ?? 0) - (a.chat.updatedAt?.toDate?.().getTime() ?? 0),
      );
  }, [chats, profiles, missing, me, filter]);

  async function pick(chatId: string) {
    if (sending) return;
    setSending(chatId);
    setError(null);
    const ok = await onPick(chatId).catch(() => false);
    if (!ok) {
      setSending(null);
      setError('That chat is still being secured. Try again in a moment.');
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm md:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Forward to"
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[80dvh] w-full max-w-md flex-col rounded-t-3xl border-t border-line bg-surface
          pb-[max(0.75rem,env(safe-area-inset-bottom))] md:rounded-3xl md:border"
      >
        <div className="flex items-center gap-2 px-4 pt-4">
          <h2 className="flex-1 text-[16px] font-semibold">Forward to</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid size-9 place-items-center rounded-full text-muted hover:bg-elevated"
          >
            <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <p className="mx-4 mt-2 line-clamp-2 rounded-xl border-l-[3px] border-zing bg-elevated px-3 py-2 text-[13px] text-muted">
          {preview}
        </p>

        <div className="px-4 py-3">
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Search your chats"
            aria-label="Search chats to forward to"
            className="h-10 w-full rounded-xl bg-elevated px-4 text-[16px] text-ink
              placeholder:text-faint focus:outline-none focus:ring-1 focus:ring-zing"
          />
        </div>

        {error && <p className="px-4 pb-2 text-[13px] text-danger">{error}</p>}

        <ul className="min-h-0 flex-1 overflow-y-auto scroll-thin">
          {rows.length === 0 && (
            <li className="px-4 py-8 text-center text-[14px] text-muted">
              {filter.trim() ? 'No chats match that.' : 'No chats to forward to yet.'}
            </li>
          )}
          {rows.map(({ chat, peer }) => (
            <li key={chat.id}>
              <button
                onClick={() => void pick(chat.id)}
                disabled={sending !== null}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors
                  hover:bg-elevated disabled:opacity-60"
              >
                <Avatar name={peer!.displayName} photoURL={peer!.photoURL} size={40} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{peer!.displayName}</span>
                  <span className="block truncate text-[13px] text-muted">@{peer!.username}</span>
                </span>
                {sending === chat.id && <Spinner />}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
