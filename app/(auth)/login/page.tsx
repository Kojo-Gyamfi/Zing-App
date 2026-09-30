'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signInWithPopup, signInWithRedirect } from 'firebase/auth';
import { auth, googleProvider } from '@/lib/firebase/client';
import { useSession } from '@/lib/store/session';
import { Button } from '@/components/ui/Button';
import { Splash } from '@/components/Splash';
import { returnPath } from '@/lib/returnTo';

export default function LoginPage() {
  const router = useRouter();
  const status = useSession((state) => state.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'ready') router.replace(returnPath());
    if (status === 'needsProfile') router.replace('/onboarding');
    if (status === 'locked') router.replace('/unlock');
  }, [status, router]);

  if (status === 'loading') return <Splash />;

  async function signIn() {
    setBusy(true);
    setError(null);
    try {
      await signInWithPopup(auth(), googleProvider);
    } catch (cause) {
      // Installed PWAs and some in-app browsers block popups outright;
      // redirect is the fallback that always works.
      const code = (cause as { code?: string }).code ?? '';
      if (code.includes('popup')) {
        await signInWithRedirect(auth(), googleProvider);
        return;
      }
      setError('Could not sign in. Check your connection and try again.');
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh flex-col justify-between bg-void px-6 pt-safe pb-safe">
      <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/zing-logo.png" alt="" className="size-40 rounded-[36px]" />

        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Zing</h1>
          <p className="text-[15px] text-muted">Fast. Lively. Connected.</p>
        </div>

        <p className="max-w-xs text-[13px] leading-relaxed text-faint">
          Every message is encrypted on your device. Not even we can read them.
        </p>
      </div>

      <div className="space-y-4 pb-8">
        {error && <p className="text-center text-[13px] text-danger">{error}</p>}

        <Button onClick={signIn} busy={busy} className="w-full">
          Continue with Google
        </Button>

        <p className="text-center text-[12px] leading-relaxed text-faint">
          You&apos;ll pick a username and a recovery passphrase next.
        </p>
      </div>
    </main>
  );
}
