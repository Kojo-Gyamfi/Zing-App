'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ensureDirectChat } from '@/lib/db/chats';
import { useDrafts } from '@/lib/store/drafts';
import { useSession } from '@/lib/store/session';

const NO_DRAFTS: Record<string, string> = {};

/** How many unsent drafts this device holds for this account. */
export function useDraftCount(uid: string): number {
  const open = useDrafts((state) => state.open);
  useEffect(() => open(uid), [uid, open]);
  return Object.keys(useDrafts((state) => (state.owner === uid ? state.drafts : NO_DRAFTS))).length;
}

/**
 * Shortcuts to the places chats keep things -- Starred, the chat with
 * yourself -- and the unsent drafts on this device, which can be cleared
 * (they are plaintext, kept only here; see lib/store/drafts.ts).
 */
export function ChatsSettings({ uid }: { uid: string }) {
  const router = useRouter();
  const { identity, profile } = useSession();
  const setDraft = useDrafts((state) => state.set);
  const drafts = useDrafts((state) => (state.owner === uid ? state.drafts : NO_DRAFTS));
  const count = useDraftCount(uid);
  const [confirming, setConfirming] = useState(false);
  const [opening, setOpening] = useState(false);

  async function messageYourself() {
    if (!identity || !profile) return;
    setOpening(true);
    try {
      router.push(`/chats/${await ensureDirectChat({ uid, identity }, profile)}`);
    } catch {
      setOpening(false);
    }
  }

  return (
    <div className="divide-y divide-line rounded-2xl border border-line bg-surface">
      <Link href="/starred" className="flex items-center justify-between gap-3 p-4 transition-colors hover:bg-elevated">
        <span>
          <span className="block text-[14px] font-medium text-ink">Starred messages</span>
          <span className="mt-1 block text-[12px] text-faint">Everything you starred, from every chat.</span>
        </span>
        <Chevron />
      </Link>
      <button
        onClick={() => void messageYourself()}
        disabled={opening}
        className="flex w-full items-center justify-between gap-3 p-4 text-left transition-colors hover:bg-elevated disabled:opacity-60"
      >
        <span>
          <span className="block text-[14px] font-medium text-ink">Message yourself</span>
          <span className="mt-1 block text-[12px] text-faint">
            Notes, links and reminders, encrypted with a key only you hold.
          </span>
        </span>
        <Chevron />
      </button>
      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[14px] font-medium text-ink">Unsent drafts</p>
            <p className="mt-1 text-[12px] leading-relaxed text-faint">
              Kept on this device only, never synced, and wiped when you sign out.
            </p>
          </div>
          <span className="shrink-0 text-[14px] font-medium text-ink tabular-nums">{count}</span>
        </div>
        {count > 0 &&
          (confirming ? (
            <div className="flex gap-2">
              <button
                onClick={() => setConfirming(false)}
                className="h-9 flex-1 rounded-full bg-elevated text-[13px] font-medium text-ink"
              >
                Keep them
              </button>
              <button
                onClick={() => {
                  Object.keys(drafts).forEach((chatId) => setDraft(uid, chatId, ''));
                  setConfirming(false);
                }}
                className="h-9 flex-1 rounded-full bg-danger/15 text-[13px] font-medium text-danger"
              >
                Clear {count === 1 ? 'it' : `all ${count}`}
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirming(true)}
              className="h-9 rounded-full bg-elevated px-4 text-[13px] font-medium text-danger"
            >
              Clear drafts
            </button>
          ))}
      </div>
    </div>
  );
}

function Chevron() {
  return (
    <svg viewBox="0 0 24 24" className="size-5 shrink-0 text-muted" aria-hidden="true">
      <path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The build, and the one paragraph worth knowing about how Zing works. */
export function AboutSettings() {
  return (
    <div className="space-y-3 rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/zing-mark.png" alt="" className="size-10 glow-zing-sm" />
        <div>
          <p className="text-[15px] font-semibold text-ink">Zing</p>
          <p className="text-[12px] text-muted">Version {process.env.NEXT_PUBLIC_APP_VERSION ?? 'dev'}</p>
        </div>
      </div>
      <p className="text-[12px] leading-relaxed text-faint">
        Messages are sealed on this device before they are sent. Our servers store only ciphertext
        and hold no key that opens it — which also means nobody, including us, can recover your
        messages without your passphrase or recovery key.
      </p>
    </div>
  );
}
