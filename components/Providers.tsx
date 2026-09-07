'use client';

import { useEffect } from 'react';
import { useSession } from '@/lib/store/session';

/** Starts the single auth + identity listener for the whole app. */
export function Providers({ children }: { children: React.ReactNode }) {
  const start = useSession((state) => state.start);

  useEffect(() => start(), [start]);

  return <>{children}</>;
}
