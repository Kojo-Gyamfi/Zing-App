'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/store/session';
import { unwrapPrivateKey, wrapPrivateKey } from '@/lib/crypto/backup';
import { isWellFormedRecoveryKey, unwrapWithRecoveryKey } from '@/lib/crypto/recovery';
import { matchesPublicKey, publicKeyFrom } from '@/lib/crypto/identity';
import { saveIdentity } from '@/lib/crypto/vault';
import { getRecoveryBackup, getUser, updateKeyBackup } from '@/lib/db/users';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Splash } from '@/components/Splash';
import { returnPath } from '@/lib/returnTo';

const MIN_PASSPHRASE = 10;

const MISMATCH =
  'That unlocked a key, but not the one this account uses now. Your messages cannot be opened with it.';

/**
 * Reached whenever the account is known but this device holds no key:
 * a new phone, cleared browser data, or Safari evicting storage after a week
 * of not opening Zing. Common and recoverable, so the tone is matter-of-fact.
 *
 * Two ways in: the passphrase, or the recovery key. The recovery path always
 * ends by setting a new passphrase -- someone who needed it has, by
 * definition, lost the old one.
 */
export default function UnlockPage() {
  const router = useRouter();
  const { status, profile, setIdentity, signOut } = useSession();

  const [mode, setMode] = useState<'passphrase' | 'recovery' | 'newPassphrase'>('passphrase');
  const [passphrase, setPassphrase] = useState('');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [newPassphrase, setNewPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  // The key unwrapped by the recovery code, held only until a new passphrase is set.
  const [recovered, setRecovered] = useState<Uint8Array | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'signedOut') router.replace('/login');
    if (status === 'needsProfile') router.replace('/onboarding');
    if (status === 'ready') router.replace(returnPath());
  }, [status, router]);

  if (status === 'loading' || !profile) return <Splash />;

  function switchMode(next: typeof mode) {
    setError(null);
    setMode(next);
  }

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
    if (!(await matchesPublicKey(privateKey, profile!.publicKey))) {
      setError(MISMATCH);
      setBusy(false);
      return;
    }

    await saveIdentity(privateKey);
    setIdentity({ privateKey, publicKey: await publicKeyFrom(privateKey) }, profile!);
    router.replace(returnPath());
  }

  async function recover() {
    setError(null);

    if (!isWellFormedRecoveryKey(recoveryKey)) {
      setError('A recovery key is 24 letters and numbers, like ABCD-EFGH-…');
      return;
    }

    setBusy(true);
    try {
      const doc = await getRecoveryBackup(profile!.uid);
      if (!doc) {
        setError(
          'This account has no recovery key. Recovery keys are made at sign-up, or in Settings on a device that is still unlocked.',
        );
        return;
      }

      const privateKey = await unwrapWithRecoveryKey(doc.backup, recoveryKey);
      if (!privateKey) {
        setError('That recovery key did not work. If you made a newer one, use that.');
        return;
      }
      if (!(await matchesPublicKey(privateKey, profile!.publicKey))) {
        setError(MISMATCH);
        return;
      }

      setRecovered(privateKey);
      setMode('newPassphrase');
    } catch {
      setError('Could not reach Zing. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function setPassphraseAndEnter() {
    setError(null);

    if (!recovered) return;
    if (newPassphrase.length < MIN_PASSPHRASE) {
      setError(`At least ${MIN_PASSPHRASE} characters.`);
      return;
    }
    if (newPassphrase !== confirm) {
      setError('Those two do not match.');
      return;
    }

    setBusy(true);
    try {
      // The old passphrase is gone, so the backup it wrapped is useless --
      // replace it before entering, or the next new device would be stuck too.
      await updateKeyBackup(profile!.uid, await wrapPrivateKey(recovered, newPassphrase));
      await saveIdentity(recovered);

      const fresh = (await getUser(profile!.uid)) ?? profile!;
      setIdentity({ privateKey: recovered, publicKey: await publicKeyFrom(recovered) }, fresh);
      router.replace(returnPath());
    } catch {
      setError('Could not save your new passphrase. Check your connection and try again.');
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-safe pb-safe">
      <header className="pt-10 pb-8">
        <h1 className="text-2xl font-bold tracking-tight">
          {mode === 'passphrase'
            ? 'Unlock your messages'
            : mode === 'recovery'
              ? 'Use your recovery key'
              : 'Set a new passphrase'}
        </h1>
        <p className="mt-1.5 text-[14px] leading-relaxed text-muted">
          {mode === 'passphrase' ? (
            <>
              Signed in as @{profile.username}. This device does not have your key yet — enter your
              recovery passphrase to restore it.
            </>
          ) : mode === 'recovery' ? (
            <>The 24-character key you saved when you set up @{profile.username}.</>
          ) : (
            <>Your key is restored. Choose a new passphrase — the old one will stop working.</>
          )}
        </p>
      </header>

      {mode === 'passphrase' && (
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

          <button
            onClick={() => switchMode('recovery')}
            className="self-start text-[13px] font-medium text-zing"
          >
            Forgot your passphrase?
          </button>

          <p className="text-[12px] leading-relaxed text-faint">
            Without the passphrase or your recovery key, your existing messages cannot be recovered
            — not by us either.
          </p>

          <button
            onClick={() => void signOut()}
            className="mt-auto mb-8 text-[13px] text-muted underline underline-offset-4"
          >
            Sign in as someone else
          </button>
        </div>
      )}

      {mode === 'recovery' && (
        <div className="flex flex-1 flex-col gap-5">
          <Field
            label="Recovery key"
            value={recoveryKey}
            onChange={(event) => setRecoveryKey(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && recoveryKey) void recover();
            }}
            placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
            hint="Dashes, spaces and capitals don't matter."
            error={error}
            autoCapitalize="characters"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
            autoFocus
          />

          <Button onClick={recover} busy={busy} disabled={!recoveryKey} className="w-full">
            {busy ? 'Checking' : 'Continue'}
          </Button>

          <button
            onClick={() => switchMode('passphrase')}
            className="mt-auto mb-8 text-[13px] text-muted underline underline-offset-4"
          >
            Back to passphrase
          </button>
        </div>
      )}

      {mode === 'newPassphrase' && (
        <div className="flex flex-1 flex-col gap-5">
          <Field
            label="New passphrase"
            type="password"
            value={newPassphrase}
            onChange={(event) => setNewPassphrase(event.target.value)}
            hint="At least 10 characters. A few random words beats one clever word."
            autoComplete="new-password"
            autoFocus
          />

          <Field
            label="Type it again"
            type="password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && confirm) void setPassphraseAndEnter();
            }}
            error={error}
            autoComplete="new-password"
          />

          <p className="text-[12px] leading-relaxed text-faint">
            Your recovery key keeps working. If you think someone else has seen it, make a new one
            in Settings.
          </p>

          <Button
            onClick={setPassphraseAndEnter}
            busy={busy}
            disabled={!newPassphrase || !confirm}
            className="mt-auto mb-8 w-full"
          >
            Save and unlock
          </Button>
        </div>
      )}
    </main>
  );
}
