'use client';

import { useEffect } from 'react';
import { useSession } from '@/lib/store/session';
import { AppearanceSync } from '@/components/AppearanceSync';
import { NicknameCache } from '@/components/NicknameCache';
import { OutboxSender } from '@/components/OutboxSender';

/** Starts the single auth + identity listener for the whole app. */
export function Providers({ children }: { children: React.ReactNode }) {
  const start = useSession((state) => state.start);

  useEffect(() => start(), [start]);

  return (
    <>
      <AppearanceSync />
      <NicknameCache />
      <OutboxSender />
      {children}
    </>
  );
}
