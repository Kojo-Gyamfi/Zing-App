'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useSession } from '@/lib/store/session';
import { Splash } from '@/components/Splash';
import { InstallCoach } from '@/components/InstallCoach';
import { clearReturnTo, rememberReturnTo } from '@/lib/returnTo';

/**
 * The gate. Nothing inside renders until the account AND this device's key
 * are both present -- otherwise there is no way to decrypt anything to show.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const status = useSession((state) => state.status);
  // Set once the session has been ready on this mount. Losing it after that is
  // a sign-out, not a deep link, so the next sign-in starts at the chat list
  // rather than wherever the person happened to sign out from (Settings).
  const wasReady = useRef(false);

  useEffect(() => {
    // Deep links (a shared profile, a chat) should survive the detour
    // through sign-in, and be forgotten once we are back inside.
    if (status === 'ready') {
      wasReady.current = true;
      clearReturnTo();
    } else if (status !== 'loading' && !wasReady.current && pathname !== '/chats') {
      rememberReturnTo(pathname);
    }

    if (status === 'signedOut') router.replace('/login');
    if (status === 'needsProfile') router.replace('/onboarding');
    if (status === 'locked') router.replace('/unlock');
  }, [status, router, pathname]);

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
