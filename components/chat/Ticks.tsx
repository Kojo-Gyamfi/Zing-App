export type TickState = 'pending' | 'sent' | 'delivered' | 'read';

/**
 * Message status, derived rather than stored: a pending write shows a clock,
 * a server-acknowledged one a single tick, and the double ticks come from
 * comparing this message's time against the peer's delivered/read timestamps.
 * No per-message status field ever gets written.
 */
export function Ticks({ state }: { state: TickState }) {
  if (state === 'pending') {
    return (
      <svg viewBox="0 0 16 16" className="size-4 text-muted" aria-label="Sending" role="img">
        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path d="M8 4.8V8l2.2 1.4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    );
  }

  const double = state === 'delivered' || state === 'read';

  return (
    <svg
      viewBox="0 0 20 16"
      className={`size-4 ${state === 'read' ? 'text-zing-soft' : 'text-muted'}`}
      aria-label={state === 'read' ? 'Read' : double ? 'Delivered' : 'Sent'}
      role="img"
    >
      <path
        d="M1.5 8.6 4.7 11.8 11.2 4.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {double && (
        <path
          d="M7.4 8.6 10.6 11.8 17.1 4.6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

export function tickState(params: {
  pending: boolean;
  createdAt: Date | null;
  peerDeliveredAt: Date | null;
  peerReadAt: Date | null;
}): TickState {
  if (params.pending || !params.createdAt) return 'pending';
  if (params.peerReadAt && params.peerReadAt >= params.createdAt) return 'read';
  if (params.peerDeliveredAt && params.peerDeliveredAt >= params.createdAt) return 'delivered';
  return 'sent';
}
