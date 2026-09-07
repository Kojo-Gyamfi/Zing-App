'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/store/session';
import { Splash } from '@/components/Splash';

/** Entry point: send people wherever their account and key state says. */
export default function Home() {
  const router = useRouter();
  const status = useSession((state) => state.status);

  useEffect(() => {
    if (status === 'loading') return;
    router.replace(
      status === 'ready'
        ? '/chats'
        : status === 'needsProfile'
          ? '/onboarding'
          : status === 'locked'
            ? '/unlock'
            : '/login',
    );
  }, [status, router]);

  return <Splash />;
}
