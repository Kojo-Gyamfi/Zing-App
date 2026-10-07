'use client';

import { useEffect, useState } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { getPhone } from '@/lib/db/users';
import { formatPhone } from '@/lib/phone';
import { useSession } from '@/lib/store/session';
import { fromB64 } from '@/lib/crypto/codec';
import { safetyNumber } from '@/lib/crypto/safetyNumber';
import { lastSeenLabel } from '@/lib/format';
import { shareProfile } from '@/lib/share';
import type { Presence } from '@/lib/db/presence';
import type { UserDoc } from '@/lib/db/schema';

/** The other person's profile, opened by tapping their name in a chat. */
export function ChatInfoSheet({
  peer,
  presence,
  blocked,
  onBlock,
  onClose,
}: {
  peer: UserDoc;
  presence: Presence;
  /** I have blocked them. */
  blocked: boolean;
  onBlock: (on: boolean) => void;
  onClose: () => void;
}) {
  const joined = peer.createdAt?.toDate?.();

  // Readable because we share a chat with them; the rules deny it otherwise.
  // undefined while loading, so the row does not flash "No number" first.
  const [phone, setPhone] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void getPhone(peer.uid).then((number) => {
      if (live) setPhone(number);
    });
    return () => {
      live = false;
    };
  }, [peer]);

  const [shareState, setShareState] = useState<'idle' | 'copied'>('idle');

  async function share() {
    if ((await shareProfile(peer)) === 'copied') {
      setShareState('copied');
      setTimeout(() => setShareState('idle'), 2000);
    }
  }

  const [confirmingBlock, setConfirmingBlock] = useState(false);

  function toggleBlock(on: boolean) {
    onBlock(on);
    setConfirmingBlock(false);
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
                  {formatPhone(phone)}
                </a>
              ) : (
                <span className="text-faint">
                  None — or not shared until you have both sent a message
                </span>
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

        <VerifyEncryption peer={peer} />

        {confirmingBlock ? (
          <div className="space-y-3 rounded-2xl border border-danger/40 bg-void p-4">
            <p className="text-[14px] leading-relaxed text-ink">Block {peer.displayName}?</p>
            <p className="text-[13px] leading-relaxed text-muted">
              Neither of you can send messages in this chat until you unblock, and they lose your
              phone number and contacts-only photo. Your chat history stays.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmingBlock(false)}
                className="h-10 flex-1 rounded-xl bg-elevated text-[14px] font-medium text-ink"
              >
                Cancel
              </button>
              <button
                onClick={() => toggleBlock(true)}
                className="h-10 flex-1 rounded-xl bg-danger text-[14px] font-semibold text-void"
              >
                Block
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => (blocked ? toggleBlock(false) : setConfirmingBlock(true))}
            className="mx-auto block text-[13px] font-medium text-danger"
          >
            {blocked ? `Unblock ${peer.displayName}` : `Block ${peer.displayName}`}
          </button>
        )}

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

/**
 * Safety number: the same 60 digits on both phones if, and only if, each
 * holds the other's real key. Comparing them in person (or over a call) is
 * the check that nobody -- the server included -- has slipped in a key.
 */
function VerifyEncryption({ peer }: { peer: UserDoc }) {
  const identity = useSession((state) => state.identity);
  const [open, setOpen] = useState(false);
  const [number, setNumber] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !identity) return;
    let live = true;
    void fromB64(peer.publicKey)
      .then((theirs) => safetyNumber(identity.publicKey, theirs))
      .then((value) => {
        if (live) setNumber(value);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [open, identity, peer.publicKey]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mx-auto block text-[13px] font-medium text-zing"
      >
        Verify encryption
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-2xl border border-line bg-void p-4 text-center">
      <p className="text-[13px] leading-relaxed text-muted">
        Compare these numbers with {peer.displayName}, in person or on a call. If they match on
        both phones, nobody can read your messages but the two of you.
      </p>
      <p className="font-mono text-[16px] leading-relaxed tracking-wider text-ink">
        {number ?? '…'}
      </p>
    </div>
  );
}
