'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { reportError } from '@/lib/monitoring';

/**
 * A crash inside one conversation. Caught here, below the chats layout, so
 * the chat list beside it (and its listener) carries on -- the root boundary
 * would replace the whole app.
 */
export default function ThreadError({
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
    <div className="flex h-dvh flex-col items-center justify-center gap-3 bg-void px-8 text-center">
      <h1 className="text-lg font-semibold">This chat couldn&apos;t be shown</h1>
      <p className="max-w-xs text-[14px] leading-relaxed text-muted">
        Your messages are safe. Try again, or go back to your chats.
      </p>
      <div className="mt-2 flex gap-2">
        <button
          onClick={() => retry()}
          className="h-11 rounded-2xl bg-zing px-5 text-[15px] font-semibold text-on-zing"
        >
          Try again
        </button>
        <Link
          href="/chats"
          className="grid h-11 place-items-center rounded-2xl bg-elevated px-5 text-[15px] font-semibold text-ink"
        >
          Chats
        </Link>
      </div>
    </div>
  );
}
