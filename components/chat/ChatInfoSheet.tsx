'use client';

import { useEffect, useState } from 'react';
import { safetyNumber } from '@/lib/crypto/safetyNumber';
import { fromB64 } from '@/lib/crypto/codec';
import { Avatar } from '@/components/ui/Avatar';
import type { Identity } from '@/lib/crypto/types';
import type { UserDoc } from '@/lib/db/schema';

/**
 * Peer detail and the safety number.
 *
 * Zing hands out public keys through Firestore, so in principle a compromised
 * server could substitute its own and sit in the middle. Comparing these 60
 * digits out of band -- in person, or over a call -- is what rules that out.
 * Without this screen the encryption is only as trustworthy as the server we
 * spent the whole app not trusting.
 */
export function ChatInfoSheet({
  peer,
  identity,
  onClose,
}: {
  peer: UserDoc;
  identity: Identity;
  onClose: () => void;
}) {
  const [digits, setDigits] = useState<string | null>(null);

  useEffect(() => {
    void fromB64(peer.publicKey)
      .then((peerKey) => safetyNumber(identity.publicKey, peerKey))
      .then(setDigits);
  }, [peer.publicKey, identity.publicKey]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm md:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Chat info"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md space-y-5 rounded-t-3xl border-t border-line bg-surface
          p-6 pb-safe md:rounded-3xl md:border"
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <Avatar name={peer.displayName} photoURL={peer.photoURL} size={80} />
          <div>
            <p className="text-lg font-semibold">{peer.displayName}</p>
            <p className="text-[14px] text-muted">@{peer.username}</p>
          </div>
          {peer.about && <p className="text-[13px] text-muted">{peer.about}</p>}
        </div>

        <div className="space-y-3 rounded-2xl border border-line bg-void p-4">
          <p className="text-[13px] font-medium text-ink">Safety number</p>

          {digits ? (
            <p className="grid grid-cols-4 gap-x-3 gap-y-1 font-mono text-[13px] text-muted">
              {digits.split(' ').map((group, index) => (
                <span key={index}>{group}</span>
              ))}
            </p>
          ) : (
            <p className="font-mono text-[13px] text-faint">calculating…</p>
          )}

          <p className="text-[12px] leading-relaxed text-faint">
            Compare these digits with {peer.displayName} in person or on a call. If they match, no
            one is intercepting this conversation. If they ever change without a new device being
            set up, stop and ask why.
          </p>
        </div>

        <button
          onClick={onClose}
          className="h-12 w-full rounded-2xl bg-elevated text-[15px] font-semibold text-ink"
        >
          Close
        </button>
      </div>
    </div>
  );
}
