'use client';

import { dayAndTime } from '@/lib/format';
import { usePrivacy } from '@/lib/store/account';
import type { DecryptedMessage } from '@/lib/db/schema';
import { Ticks } from './Ticks';

/**
 * "Info" on one of my messages: when it was sent, delivered and read.
 *
 * Receipts are one timestamp per chat, not one per message (see
 * lib/receipts.ts), so delivered and read are known only as "by" a time --
 * the moment the newest receipt covering this message landed. An exact time
 * per message would cost a write per message.
 */
export function MessageInfoSheet({
  message,
  peerName,
  peerDeliveredAt,
  peerReadAt,
  onClose,
}: {
  message: DecryptedMessage;
  peerName: string;
  peerDeliveredAt: Date | null;
  peerReadAt: Date | null;
  onClose: () => void;
}) {
  const privacy = usePrivacy();
  const sent = message.createdAt;
  const read = sent && peerReadAt && peerReadAt >= sent ? peerReadAt : null;
  // Read implies delivered, even if the delivery receipt itself never came.
  const delivered =
    sent && peerDeliveredAt && peerDeliveredAt >= sent ? peerDeliveredAt : read;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm md:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Message info"
        onClick={(event) => event.stopPropagation()}
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto scroll-thin space-y-4 rounded-t-3xl border-t border-line bg-surface p-5
          pb-[max(1.25rem,env(safe-area-inset-bottom))] md:rounded-3xl md:border"
      >
        <p className="text-[15px] font-semibold">Message info</p>

        {message.text !== null && (
          <p className="line-clamp-4 rounded-2xl bg-bubble-out px-3 py-2 text-[14px] break-words whitespace-pre-wrap text-ink">
            {message.text}
          </p>
        )}

        <dl className="divide-y divide-line rounded-2xl border border-line bg-void">
          <Row label="Read" icon={<Ticks state="read" />}>
            {read
              ? `By ${dayAndTime(read)}`
              : privacy.readReceipts
                ? '—'
                : 'Your read receipts are off, so you don’t see theirs'}
          </Row>
          <Row label="Delivered" icon={<Ticks state="delivered" />}>
            {delivered ? `By ${dayAndTime(delivered)}` : '—'}
          </Row>
          <Row label="Sent" icon={<Ticks state="sent" />}>
            {sent ? dayAndTime(sent) : '—'}
          </Row>
          {message.expiresAt && (
            <Row label="Disappears">{dayAndTime(message.expiresAt)}</Row>
          )}
        </dl>

        <p className="text-[12px] leading-relaxed text-faint">
          Times are when {peerName}&apos;s phone reported it, for this message or a later one.
          Someone with read receipts off never shows as having read.
        </p>

        <button
          onClick={onClose}
          className="h-11 w-full rounded-2xl bg-elevated text-[15px] font-medium text-ink"
        >
          Close
        </button>
      </div>
    </div>
  );
}

function Row({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="px-4 py-3">
      <dt className="flex items-center gap-1.5 text-[12px] text-muted">
        {icon}
        {label}
      </dt>
      <dd className="mt-0.5 text-[14px] text-ink">{children}</dd>
    </div>
  );
}
