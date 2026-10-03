'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/store/session';
import { generateIdentity } from '@/lib/crypto/identity';
import { wrapPrivateKey } from '@/lib/crypto/backup';
import { generateRecoveryKey, wrapWithRecoveryKey } from '@/lib/crypto/recovery';
import { saveIdentity } from '@/lib/crypto/vault';
import { toB64 } from '@/lib/crypto/codec';
import type { Identity } from '@/lib/crypto/types';
import {
  createProfile,
  findByUsername,
  findByPhone,
  normalizeUsername,
  USERNAME_PATTERN,
  getUser,
} from '@/lib/db/users';
import { Button } from '@/components/ui/Button';
import { AuthFrame } from '@/components/AuthFrame';
import { Field } from '@/components/ui/Field';
import { Splash } from '@/components/Splash';
import { RecoveryKeyDisplay } from '@/components/RecoveryKeyDisplay';
import { returnPath } from '@/lib/returnTo';
import { limitPhoneInput, tryNormalizePhone } from '@/lib/phone';
import { clearLoginIntent, getLoginIntent } from '@/lib/loginIntent';

const MIN_PASSPHRASE = 10;
const PHONE_INVALID_MESSAGE = 'That doesn’t look like a valid phone number (up to 10 digits).';

export default function OnboardingPage() {
  const router = useRouter();
  const { status, user, setIdentity, signOut } = useSession();
  // Read once. Only rendered after the session loads, so the server's null
  // never has to match the client's value during hydration.
  const [expectedAccount] = useState(() => getLoginIntent() === 'signin');

  const [step, setStep] = useState<'handle' | 'passphrase' | 'recovery'>('handle');
  const [username, setUsername] = useState('');
  const [phone, setPhone] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [understood, setUnderstood] = useState(false);
  // Held between account creation and the recovery step: the session only
  // becomes ready once the key has been saved, or it would redirect away first.
  const [identity, setCreatedIdentity] = useState<Identity | null>(null);
  const [recoveryKey, setRecoveryKey] = useState('');
  const [recoverySaved, setRecoverySaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'signedOut') router.replace('/login');
    if (status === 'ready') router.replace(returnPath());
    if (status === 'locked') router.replace('/unlock');
  }, [status, router]);

  if (status === 'loading' || !user) return <Splash />;

  const handle = normalizeUsername(username);

  async function continueToPassphrase() {
    setError(null);
    setPhoneError(null);

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
    if (phone.trim() && !tryNormalizePhone(phone)) {
      setPhoneError(PHONE_INVALID_MESSAGE);
      setBusy(false);
      return;
    }
    if (phone.trim() && (await findByPhone(phone))) {
      setPhoneError('That number is already linked to another account.');
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
      const freshRecoveryKey = await generateRecoveryKey();
      const recoveryBackup = await wrapWithRecoveryKey(identity.privateKey, freshRecoveryKey);

      // Profile first: if this fails on a taken username we have not yet
      // written a key to the device that no account refers to.
      await createProfile({
        uid: user!.uid,
        username: handle,
        displayName: user!.displayName ?? handle,
        photoURL: user!.photoURL ?? null,
        publicKey: await toB64(identity.publicKey),
        keyBackup,
        recoveryBackup,
        phone: phone.trim() || null,
      });

      await saveIdentity(identity.privateKey);

      setCreatedIdentity(identity);
      setRecoveryKey(freshRecoveryKey);
      setBusy(false);
      setStep('recovery');
    } catch (cause) {
      const code = (cause as Error).message;
      setError(
        code === 'USERNAME_TAKEN'
          ? 'Someone just took that username. Pick another.'
          : code === 'PHONE_TAKEN'
            ? 'That phone number is already linked to another account.'
            : code === 'PHONE_INVALID'
              ? PHONE_INVALID_MESSAGE
              : 'Something went wrong setting up your account.',
      );
      setBusy(false);
    }
  }

  async function enterApp() {
    if (!identity) return;
    setBusy(true);
    const profile = await getUser(user!.uid);
    if (profile) setIdentity(identity, profile);
    clearLoginIntent();
    router.replace(returnPath());
  }

  return (
    <AuthFrame>
      <header className="pt-10 pb-8">
        <h1 className="text-2xl font-bold tracking-tight">
          {step === 'handle'
            ? 'Pick your handle'
            : step === 'passphrase'
              ? 'Set a recovery passphrase'
              : 'Save your recovery key'}
        </h1>
        <p className="mt-1.5 text-[14px] text-muted">
          {step === 'handle'
            ? 'This is how friends find you on Zing.'
            : step === 'passphrase'
              ? 'This is how you unlock your messages on a new device.'
              : 'Your backup in case the passphrase is ever forgotten.'}
        </p>
      </header>

      {step === 'handle' ? (
        <div className="flex flex-1 flex-col gap-5">
          {expectedAccount && (
            <div className="rounded-2xl border border-line bg-surface p-4">
              <p className="text-[14px] font-medium text-ink">No Zing account found</p>
              <p className="mt-1 text-[13px] leading-relaxed text-muted">
                {user.email ?? 'This account'} isn&apos;t linked to a Zing account yet. If you
                signed up with a different Google account or email, switch to it. Otherwise, set
                one up below.
              </p>
              <button
                onClick={() => {
                  clearLoginIntent();
                  void signOut();
                }}
                className="mt-3 text-[13px] font-medium text-zing"
              >
                Use a different account
              </button>
            </div>
          )}

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
            hint="Optional. Lets friends find you, and people you chat with can see it. Not verified — nothing is sent to it."
            value={phone}
            onChange={(event) => setPhone(limitPhoneInput(event.target.value))}
            placeholder="024 123 4567"
            inputMode="tel"
            error={phoneError}
          />

          <Button onClick={continueToPassphrase} busy={busy} className="mt-auto mb-8 w-full">
            Continue
          </Button>
        </div>
      ) : step === 'recovery' ? (
        <div className="flex flex-1 flex-col gap-5">
          <div className="rounded-2xl border border-line bg-surface p-4">
            <p className="text-[13px] leading-relaxed text-muted">
              If you forget your passphrase, this key is the only other way back in. Write it down
              or keep it in a password manager.
            </p>
            <p className="mt-3 text-[13px] leading-relaxed font-medium text-ink">
              We can&apos;t show it again.
            </p>
          </div>

          <RecoveryKeyDisplay recoveryKey={recoveryKey} username={handle} />

          <label className="flex items-start gap-3 text-[13px] leading-relaxed text-muted">
            <input
              type="checkbox"
              checked={recoverySaved}
              onChange={(event) => setRecoverySaved(event.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-zing"
            />
            I&apos;ve saved my recovery key.
          </label>

          <Button
            onClick={() => void enterApp()}
            busy={busy}
            disabled={!recoverySaved}
            className="mt-auto mb-8 w-full"
          >
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
              We cannot reset it. Next you get a recovery key, the only other way back in. Lose
              both and every message is gone permanently — there is no backdoor, which is the
              entire point.
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
    </AuthFrame>
  );
}
