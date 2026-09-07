'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/store/session';
import { Splash } from '@/components/Splash';
import { InstallCoach } from '@/components/InstallCoach';

/**
 * The gate. Nothing inside renders until the account AND this device's key
 * are both present -- otherwise there is no way to decrypt anything to show.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const status = useSession((state) => state.status);

  useEffect(() => {
    if (status === 'signedOut') router.replace('/login');
    if (status === 'needsProfile') router.replace('/onboarding');
    if (status === 'locked') router.replace('/unlock');
  }, [status, router]);

  if (status !== 'ready') {
    return <Splash label={status === 'locked' ? 'Unlocking' : 'Loading'} />;
  }

  return (
    <>
      {children}
      <InstallCoach />
    </>
  );
}
