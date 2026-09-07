'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/store/session';
import { generateIdentity } from '@/lib/crypto/identity';
import { wrapPrivateKey } from '@/lib/crypto/backup';
import { saveIdentity } from '@/lib/crypto/vault';
import { toB64 } from '@/lib/crypto/codec';
import { createProfile, findByUsername, normalizeUsername, USERNAME_PATTERN, getUser } from '@/lib/db/users';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Splash } from '@/components/Splash';

const MIN_PASSPHRASE = 10;

export default function OnboardingPage() {
  const router = useRouter();
  const { status, user, setIdentity } = useSession();

  const [step, setStep] = useState<'handle' | 'passphrase'>('handle');
  const [username, setUsername] = useState('');
  const [phone, setPhone] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'signedOut') router.replace('/login');
    if (status === 'ready') router.replace('/chats');
    if (status === 'locked') router.replace('/unlock');
  }, [status, router]);

  if (status === 'loading' || !user) return <Splash />;

  const handle = normalizeUsername(username);

  async function continueToPassphrase() {
    setError(null);

    if (!USERNAME_PATTERN.test(handle)) {
      setError('3–20 characters, using letters, numbers or underscores.');
      return;
    }

    setBusy(true);
    if (await findByUsername(handle)) {
      setError('That username is taken.');
      setBusy(false);
      return;
    }
    setBusy(false);
    setStep('passphrase');
  }

  async function finish() {
    setError(null);

    if (passphrase.length < MIN_PASSPHRASE) {
      setError(`At least ${MIN_PASSPHRASE} characters.`);
      return;
    }
    if (passphrase !== confirm) {
      setError('Those two do not match.');
      return;
    }

    setBusy(true);
    try {
      const identity = await generateIdentity();
      const keyBackup = await wrapPrivateKey(identity.privateKey, passphrase);

      // Profile first: if this fails on a taken username we have not yet
      // written a key to the device that no account refers to.
      await createProfile({
        uid: user!.uid,
        username: handle,
        displayName: user!.displayName ?? handle,
        photoURL: user!.photoURL ?? null,
        publicKey: await toB64(identity.publicKey),
        keyBackup,
        phone: phone.trim() ? phone.replace(/[\s-]/g, '') : null,
      });

      await saveIdentity(identity.privateKey);

      const profile = await getUser(user!.uid);
      if (profile) setIdentity(identity, profile);
      router.replace('/chats');
    } catch (cause) {
      setError(
        (cause as Error).message === 'USERNAME_TAKEN'
          ? 'Someone just took that username. Pick another.'
          : 'Something went wrong setting up your account.',
      );
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-safe pb-safe">
      <header className="pt-10 pb-8">
        <h1 className="text-2xl font-bold tracking-tight">
          {step === 'handle' ? 'Pick your handle' : 'Set a recovery passphrase'}
        </h1>
        <p className="mt-1.5 text-[14px] text-muted">
          {step === 'handle'
            ? 'This is how friends find you on Zing.'
            : 'This is the only way back into your messages.'}
        </p>
      </header>

      {step === 'handle' ? (
        <div className="flex flex-1 flex-col gap-5">
          <Field
            label="Username"
            prefix="@"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="kwame"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={20}
            error={error}
          />

          <Field
            label="Phone number"
            hint="Optional. Lets friends who know your number find you — nothing is sent to it."
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="+233 …"
            inputMode="tel"
          />

          <Button onClick={continueToPassphrase} busy={busy} className="mt-auto mb-8 w-full">
            Continue
          </Button>
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-5">
          {/*
            The bluntest screen in the app, deliberately. Everything else can be
            recovered by a support conversation; this cannot be recovered by
            anyone, including us, and people need to feel that before they type
            something forgettable.
          */}
          <div className="rounded-2xl border border-line bg-surface p-4">
            <p className="text-[13px] leading-relaxed text-muted">
              Your messages are encrypted with a key that never leaves your phone. If you sign in
              somewhere else, this passphrase is what unlocks them.
            </p>
            <p className="mt-3 text-[13px] leading-relaxed font-medium text-ink">
              We cannot reset it. Forget it and every message is gone permanently — there is no
              backdoor, which is the entire point.
            </p>
          </div>

          <Field
            label="Passphrase"
            type="password"
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
            hint="At least 10 characters. A few random words beats one clever word."
            autoComplete="new-password"
          />

          <Field
            label="Type it again"
            type="password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            error={error}
            autoComplete="new-password"
          />

          <label className="flex items-start gap-3 text-[13px] leading-relaxed text-muted">
            <input
              type="checkbox"
              checked={understood}
              onChange={(event) => setUnderstood(event.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-zing"
            />
            I have written this down somewhere safe.
          </label>

          <Button
            onClick={finish}
            busy={busy}
            disabled={!understood}
            className="mt-auto mb-8 w-full"
          >
            Create my account
          </Button>
        </div>
      )}
    </main>
  );
}
