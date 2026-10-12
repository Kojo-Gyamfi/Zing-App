'use client';

import { useEffect, useState } from 'react';

type Estimate = { used: number; persisted: boolean | null };

function size(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** How much this device holds for Zing, and whether the browser may evict it. */
export function useStorageEstimate() {
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const refresh = () =>
    void Promise.all([
      navigator.storage?.estimate?.().catch(() => null),
      navigator.storage?.persisted?.().catch(() => null),
    ]).then(([usage, persisted]) =>
      setEstimate({ used: usage?.usage ?? 0, persisted: persisted ?? null }),
    );
  useEffect(refresh, []);
  return { estimate, refresh };
}

export function storageSummary(estimate: Estimate | null): string {
  if (!estimate) return 'Checking…';
  return `${size(estimate.used)} on this device${estimate.persisted ? ' · kept safe' : ''}`;
}

/**
 * This device's share of Zing: the key, cached chats and drafts. The thing
 * worth knowing is whether the browser may clear it under storage pressure --
 * that is what sends people back to typing their passphrase -- and the
 * browser can be asked not to.
 */
export function StorageSettings({ storage }: { storage: ReturnType<typeof useStorageEstimate> }) {
  const { estimate, refresh } = storage;
  const [asked, setAsked] = useState<'kept' | 'declined' | null>(null);

  async function keep() {
    const granted = (await navigator.storage?.persist?.().catch(() => false)) ?? false;
    setAsked(granted ? 'kept' : 'declined');
    refresh();
  }

  return (
    <div className="divide-y divide-line rounded-2xl border border-line bg-surface">
      <div className="flex items-center justify-between gap-3 p-4">
        <div>
          <p className="text-[14px] font-medium text-ink">Used on this device</p>
          <p className="mt-1 text-[12px] leading-relaxed text-faint">
            Your key, cached messages and drafts. All of it stays encrypted or on this device.
          </p>
        </div>
        <span className="shrink-0 text-[14px] font-medium text-ink tabular-nums">
          {estimate ? size(estimate.used) : '…'}
        </span>
      </div>
      <div className="space-y-3 p-4">
        <div>
          <p className="text-[14px] font-medium text-ink">
            Keep Zing’s data safe
            {estimate?.persisted && <span className="ml-2 text-[13px] text-zing">On</span>}
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-faint">
            {estimate?.persisted
              ? 'This browser won’t clear Zing’s data when space runs low, so you won’t be asked for your passphrase again.'
              : asked === 'declined'
                ? 'The browser said no for now. Installing Zing to your home screen usually lets it keep the data.'
                : 'Without this, the browser may clear Zing’s data when space runs low, and you would need your passphrase again.'}
          </p>
        </div>
        {!estimate?.persisted && estimate?.persisted !== null && (
          <button
            onClick={() => void keep()}
            className="h-9 rounded-full bg-elevated px-4 text-[13px] font-medium text-zing"
          >
            Ask the browser to keep it
          </button>
        )}
      </div>
    </div>
  );
}
