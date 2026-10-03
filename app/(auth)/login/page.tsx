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
  completeLink,
  emailLinkError,
  isEmailLink,
  looksLikeEmail,
  sendLink,
} from '@/lib/auth/emailLink';

export default function LoginPage() {
  const router = useRouter();
  const status = useSession((state) => state.status);
  // null until one of the two first buttons is pressed.
  const [intent, setIntent] = useState<LoginIntent | null>(null);
  const [busy, setBusy] = useState<'google' | 'email' | 'paste' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [pasted, setPasted] = useState('');

  useEffect(() => {
    if (status === 'ready') router.replace(returnPath());
    if (status === 'needsProfile') router.replace('/onboarding');
    if (status === 'locked') router.replace('/unlock');
  }, [status, router]);

  if (status === 'loading') return <Splash />;

  function choose(next: LoginIntent) {
    setLoginIntent(next);
    setIntent(next);
    setError(null);
  }

  function back() {
    setIntent(null);
    setSentTo(null);
    setPasted('');
    setError(null);
  }

  async function withGoogle() {
    setBusy('google');
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
      // Closing Google's window is not an error worth shouting about.
      if (!code.includes('cancelled') && !code.includes('closed-by-user')) {
        setError('Could not sign in. Check your connection and try again.');
      }
      setBusy(null);
    }
  }

  async function withEmail() {
    if (!intent) return;
    if (!looksLikeEmail(email)) {
      setError('That doesn’t look like a valid email address.');
      return;
    }
    setBusy('email');
    setError(null);
    try {
      const next = returnPath();
      await sendLink(email, intent, next === '/chats' ? undefined : next);
      setSentTo(email.trim());
    } catch (cause) {
      setError(emailLinkError(cause));
    }
    setBusy(null);
  }

  async function withPastedLink() {
    if (!sentTo) return;
    if (!isEmailLink(pasted.trim())) {
      setError('That isn’t a Zing sign-in link. Copy the whole link from the email.');
      return;
    }
    setBusy('paste');
    setError(null);
    try {
      // Session status takes it from here.
      await completeLink(pasted, sentTo);
    } catch (cause) {
      setError(emailLinkError(cause));
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
        {error && <p className="text-center text-[13px] text-danger">{error}</p>}

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
          <>
            <div className="space-y-2 rounded-2xl border border-line bg-surface p-4">
              <p className="text-[14px] font-medium text-ink">Check your email</p>
              <p className="text-[13px] leading-relaxed text-muted">
                We sent a sign-in link to <span className="text-ink">{sentTo}</span>. Tap it to
                continue. Not there? Look in Junk or Spam.
              </p>
              <p className="text-[13px] leading-relaxed text-muted">
                Using Zing from your home screen? Press and hold the link in the email, copy it,
                and paste it here.
              </p>
            </div>

            <Field
              label="Sign-in link"
              type="url"
              inputMode="url"
              value={pasted}
              onChange={(event) => setPasted(event.target.value)}
              placeholder="Paste the link from the email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />

            <Button
              onClick={() => void withPastedLink()}
              busy={busy === 'paste'}
              disabled={busy !== null || !pasted.trim()}
              className="w-full"
            >
              Sign in with link
            </Button>

            <div className="flex justify-between">
              <button onClick={back} className="text-[13px] font-medium text-muted">
                Back
              </button>
              <button
                onClick={() => {
                  setSentTo(null);
                  setPasted('');
                  setError(null);
                }}
                className="text-[13px] font-medium text-zing"
              >
                Use a different email
              </button>
            </div>
          </>
        ) : (
          <>
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
              or
              <span className="h-px flex-1 bg-line" />
            </div>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                void withEmail();
              }}
              className="space-y-3"
            >
              <Field
                label="Email"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@icloud.com"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
              <Button
                type="submit"
                variant="ghost"
                busy={busy === 'email'}
                disabled={busy !== null || !email.trim()}
                className="w-full border border-line"
              >
                Email me a sign-in link
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
