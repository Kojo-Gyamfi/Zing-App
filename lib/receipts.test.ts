import { describe, expect, it } from 'vitest';
import { needsDeliveryReceipt, needsReadReceipt } from './receipts';

const ME = 'me';
const PEER = 'peer';
const at = (seconds: number) => new Date(Date.UTC(2026, 8, 30, 12, 0, seconds));

describe('needsDeliveryReceipt', () => {
  const base = {
    me: ME,
    pending: false,
    lastSenderId: PEER,
    updatedAt: at(10),
    deliveredAt: at(0),
    acknowledged: undefined,
  };

  it('acknowledges a new incoming message', () => {
    expect(needsDeliveryReceipt(base)).toBe(true);
  });

  it('never acknowledges my own message', () => {
    expect(needsDeliveryReceipt({ ...base, lastSenderId: ME })).toBe(false);
  });

  it('does nothing once the server has a newer receipt', () => {
    expect(needsDeliveryReceipt({ ...base, deliveredAt: at(11) })).toBe(false);
  });

  // The loop that exhausted the quota: our receipt is pending, and this
  // device's clock (standing in for the server timestamp) is 2s slow, so the
  // receipt looks older than the message.
  it('ignores its own unconfirmed receipt even when the local clock is behind', () => {
    expect(needsDeliveryReceipt({ ...base, pending: true, deliveredAt: at(8) })).toBe(false);
  });

  it('acknowledges each message at most once, even if the server copy lags', () => {
    const acknowledged = base.updatedAt.getTime();
    expect(needsDeliveryReceipt({ ...base, acknowledged, deliveredAt: at(8) })).toBe(false);
  });

  it('acknowledges the next message after that', () => {
    const acknowledged = base.updatedAt.getTime();
    expect(needsDeliveryReceipt({ ...base, acknowledged, updatedAt: at(20) })).toBe(true);
  });

  it('replays a snapshot storm and writes exactly once', () => {
    let acknowledged: number | undefined;
    let writes = 0;

    // First the server snapshot, then a burst of local ones carrying our own
    // pending receipt stamped with a slow clock, then the confirmed one.
    const snapshots = [
      { pending: false, deliveredAt: at(0) },
      ...Array.from({ length: 50 }, () => ({ pending: true, deliveredAt: at(8) })),
      { pending: false, deliveredAt: at(12) },
    ];

    for (const snapshot of snapshots) {
      if (needsDeliveryReceipt({ ...base, ...snapshot, acknowledged })) {
        writes += 1;
        acknowledged = base.updatedAt.getTime();
      }
    }

    expect(writes).toBe(1);
  });
});

describe('needsReadReceipt', () => {
  const newestIncoming = { id: 'm1', createdAt: at(10) };

  it('marks read when there is an unread incoming message', () => {
    expect(needsReadReceipt({ newestIncoming, readAt: at(0), marked: null })).toBe(true);
  });

  it('marks read the first time, when nothing has been read', () => {
    expect(needsReadReceipt({ newestIncoming, readAt: null, marked: null })).toBe(true);
  });

  it('waits until the server copy of lastRead is known', () => {
    expect(needsReadReceipt({ newestIncoming, readAt: undefined, marked: null })).toBe(false);
  });

  it('skips opening a chat that is already read', () => {
    expect(needsReadReceipt({ newestIncoming, readAt: at(11), marked: null })).toBe(false);
  });

  it('skips chats with nothing from the other person, so my sends never write one', () => {
    expect(needsReadReceipt({ newestIncoming: undefined, readAt: at(0), marked: null })).toBe(false);
  });

  it('marks each message at most once, even if the server copy lags', () => {
    expect(needsReadReceipt({ newestIncoming, readAt: at(8), marked: 'm1' })).toBe(false);
  });
});
