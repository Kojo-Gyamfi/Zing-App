'use client';

import { useEffect } from 'react';
import { reportError } from '@/lib/monitoring';

/**
 * A render crash anywhere below the root layout. Without this the screen just
 * goes blank. Messages are safe either way -- they live in Firestore and the
 * local cache, not in whatever just crashed.
 */
export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    reportError(error);
  }, [error]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-void px-8 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icon-192.png" alt="" className="size-16 rounded-2xl opacity-60" />
      <h1 className="text-lg font-semibold">Something broke</h1>
      <p className="max-w-xs text-[14px] leading-relaxed text-muted">
        Your messages are safe. Try again, or reload Zing if it keeps happening.
      </p>
      <div className="mt-2 flex gap-2">
        <button
          onClick={() => retry()}
          className="h-11 rounded-2xl bg-zing px-5 text-[15px] font-semibold text-on-zing"
        >
          Try again
        </button>
        <button
          onClick={() => window.location.reload()}
          className="h-11 rounded-2xl bg-elevated px-5 text-[15px] font-semibold text-ink"
        >
          Reload
        </button>
      </div>
    </main>
  );
}
