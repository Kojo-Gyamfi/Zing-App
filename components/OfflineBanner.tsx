'use client';

import { useEffect, useState } from 'react';
import { subscribeConnection } from '@/lib/db/presence';

/** How long to wait before saying so: the socket takes a moment on launch. */
const GRACE_MS = 3000;

/**
 * "Waiting for network…", so messages sitting on a clock icon make sense.
 * Firestore queues them and sends on reconnect; this just says that is what
 * is happening.
 */
export function OfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let connected = false;

    const update = () => {
      if (timer) clearTimeout(timer);
      if (connected && navigator.onLine) {
        setOffline(false);
        return;
      }
      timer = setTimeout(() => setOffline(true), navigator.onLine ? GRACE_MS : 0);
    };

    const stop = subscribeConnection((value) => {
      connected = value;
      update();
    });
    window.addEventListener('online', update);
    window.addEventListener('offline', update);

    return () => {
      stop();
      if (timer) clearTimeout(timer);
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-2 bg-elevated px-4 pt-safe pb-1.5 text-[13px] text-muted shadow-lg shadow-black/30"
    >
      <span className="size-2 animate-pulse rounded-full bg-zing" aria-hidden="true" />
      Waiting for network… messages will send when you are back online.
    </div>
  );
}
