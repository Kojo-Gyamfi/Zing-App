'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/store/session';
import { unwrapPrivateKey } from '@/lib/crypto/backup';
import { publicKeyFrom } from '@/lib/crypto/identity';
import { saveIdentity } from '@/lib/crypto/vault';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Splash } from '@/components/Splash';
import { returnPath } from '@/lib/returnTo';

/**
 * Reached whenever the account is known but this device holds no key:
 * a new phone, cleared browser data, or Safari evicting storage after a week
 * of not opening Zing. Common and recoverable, so the tone is matter-of-fact.
 */
export default function UnlockPage() {
  const router = useRouter();
  const { status, profile, setIdentity, signOut } = useSession();

  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'signedOut') router.replace('/login');
    if (status === 'needsProfile') router.replace('/onboarding');
    if (status === 'ready') router.replace(returnPath());
  }, [status, router]);

  if (status === 'loading' || !profile) return <Splash />;

  async function unlock() {
    setError(null);
    setBusy(true);

    // Argon2id is deliberately slow -- a second or two here is the cost that
    // makes the stored backup useless to anyone brute-forcing it.
    const privateKey = await unwrapPrivateKey(profile!.keyBackup, passphrase);

    if (!privateKey) {
      setError('That passphrase did not work.');
      setBusy(false);
      return;
    }

    await saveIdentity(privateKey);
    setIdentity({ privateKey, publicKey: await publicKeyFrom(privateKey) }, profile!);
    router.replace(returnPath());
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-safe pb-safe">
      <header className="pt-10 pb-8">
        <h1 className="text-2xl font-bold tracking-tight">Unlock your messages</h1>
        <p className="mt-1.5 text-[14px] leading-relaxed text-muted">
          Signed in as @{profile.username}. This device does not have your key yet — enter your
          recovery passphrase to restore it.
        </p>
      </header>

      <div className="flex flex-1 flex-col gap-5">
        <Field
          label="Recovery passphrase"
          type="password"
          value={passphrase}
          onChange={(event) => setPassphrase(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && passphrase) void unlock();
          }}
          error={error}
          autoComplete="current-password"
          autoFocus
        />

        <Button onClick={unlock} busy={busy} disabled={!passphrase} className="w-full">
          {busy ? 'Unlocking' : 'Unlock'}
        </Button>

        <p className="text-[12px] leading-relaxed text-faint">
          Without the passphrase your existing messages cannot be recovered — not by us either. You
          can start fresh with a new key, but the old conversations stay unreadable.
        </p>

        <button
          onClick={() => void signOut()}
          className="mt-auto mb-8 text-[13px] text-muted underline underline-offset-4"
        >
          Sign in as someone else
        </button>
      </div>
    </main>
  );
}
