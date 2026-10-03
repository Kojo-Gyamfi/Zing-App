'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signInWithPopup, signInWithRedirect } from 'firebase/auth';
import { auth, googleProvider } from '@/lib/firebase/client';
import { useSession } from '@/lib/store/session';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Splash } from '@/components/Splash';
import { returnPath } from '@/lib/returnTo';
import { setLoginIntent, type LoginIntent } from '@/lib/loginIntent';
import {
  emailCodeError,
  looksLikeEmail,
  requestCode,
  verifyCode,
} from '@/lib/auth/emailCodeClient';

/** Matches the server's one-code-a-minute limit. */
const RESEND_AFTER_S = 60;

export default function LoginPage() {
  const router = useRouter();
  const status = useSession((state) => state.status);
  // null until one of the two first buttons is pressed.
  const [intent, setIntent] = useState<LoginIntent | null>(null);
  const [busy, setBusy] = useState<'google' | 'email' | 'code' | 'resend' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [googleError, setGoogleError] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (status === 'ready') router.replace(returnPath());
    if (status === 'needsProfile') router.replace('/onboarding');
    if (status === 'locked') router.replace('/unlock');
  }, [status, router]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  if (status === 'loading') return <Splash />;

  function choose(next: LoginIntent) {
    setLoginIntent(next);
    setIntent(next);
    setError(null);
  }

  function back() {
    setIntent(null);
    setGoogleError(null);
    setSentTo(null);
    setCode('');
    setError(null);
  }

  async function withGoogle() {
    setBusy('google');
    setGoogleError(null);
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
      // Closing Google's window is not an error worth shouting about.
      if (!code.includes('cancelled') && !code.includes('closed-by-user')) {
        setGoogleError('Could not sign in with Google. Check your connection and try again.');
      }
      setBusy(null);
    }
  }

  async function sendCode(resend = false) {
    if (!intent) return;
    const address = resend && sentTo ? sentTo : email.trim();
    if (!looksLikeEmail(address)) {
      setError('That doesn’t look like a valid email address.');
      return;
    }
    setBusy(resend ? 'resend' : 'email');
    setError(null);
    try {
      // "I already have an account" is checked here: an unknown address is
      // refused before any email goes out.
      await requestCode(address, intent);
      setSentTo(address);
      setCode('');
      setResendIn(RESEND_AFTER_S);
    } catch (cause) {
      setError(emailCodeError(cause));
    }
    setBusy(null);
  }

  async function checkCode() {
    if (!sentTo) return;
    setBusy('code');
    setError(null);
    try {
      // Session status takes it from here.
      await verifyCode(sentTo, code);
    } catch (cause) {
      setError(emailCodeError(cause));
      setBusy(null);
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
        {intent === null ? (
          <>
            <Button onClick={() => choose('signup')} className="w-full">
              Create an account
            </Button>

            <Button
              variant="ghost"
              onClick={() => choose('signin')}
              className="w-full border border-line"
            >
              I already have an account
            </Button>

            <p className="text-center text-[12px] leading-relaxed text-faint">
              Continue with Google or any email address. Signing back in? Use the same one, then
              enter your recovery passphrase to unlock your messages.
            </p>
          </>
        ) : sentTo ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void checkCode();
            }}
            className="space-y-4"
          >
            <div className="space-y-1 text-center">
              <p className="text-[15px] font-medium text-ink">Check your email</p>
              <p className="text-[13px] leading-relaxed text-muted">
                We sent a 6-digit code to <span className="text-ink">{sentTo}</span>. Not there?
                Check Spam.
              </p>
            </div>

            <Field
              label="Code"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              maxLength={6}
              error={error}
              className="text-center tracking-[0.4em]"
            />

            <Button
              type="submit"
              busy={busy === 'code'}
              disabled={busy !== null || code.length !== 6}
              className="w-full"
            >
              Verify
            </Button>

            <div className="flex justify-between">
              <button
                type="button"
                onClick={() => {
                  setSentTo(null);
                  setCode('');
                  setError(null);
                }}
                className="text-[13px] font-medium text-muted"
              >
                Use a different email
              </button>
              <button
                type="button"
                onClick={() => void sendCode(true)}
                disabled={busy !== null || resendIn > 0}
                className="text-[13px] font-medium text-zing disabled:opacity-40"
              >
                {resendIn > 0 ? `Resend code in ${resendIn}s` : 'Resend code'}
              </button>
            </div>
          </form>
        ) : (
          <>
            {googleError && <p className="text-center text-[13px] text-danger">{googleError}</p>}

            <Button
              onClick={() => void withGoogle()}
              busy={busy === 'google'}
              disabled={busy !== null}
              className="w-full"
            >
              Continue with Google
            </Button>

            <div className="flex items-center gap-3 text-[12px] text-faint">
              <span className="h-px flex-1 bg-line" />
              or use your email
              <span className="h-px flex-1 bg-line" />
            </div>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                void sendCode();
              }}
              className="space-y-3"
            >
              <Field
                label="Email"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setError(null);
                }}
                placeholder="you@icloud.com"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                error={error}
              />
              <Button
                type="submit"
                variant="ghost"
                busy={busy === 'email'}
                disabled={busy !== null || !email.trim()}
                className="w-full border border-line"
              >
                Continue
              </Button>
            </form>

            <button onClick={back} className="w-full text-center text-[13px] font-medium text-muted">
              Back
            </button>
          </>
        )}
      </div>
    </main>
  );
}
