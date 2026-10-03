'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/store/session';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Splash } from '@/components/Splash';
import { rememberReturnTo, returnPath } from '@/lib/returnTo';
import { setLoginIntent } from '@/lib/loginIntent';
import {
  completeLink,
  emailLinkError,
  isEmailLink,
  looksLikeEmail,
  readFinishParams,
  storedEmail,
} from '@/lib/auth/emailLink';

/**
 * Where an emailed sign-in link lands. Finishes the sign-in, then hands over
 * to the session, which routes on to onboarding, unlock or the app like the
 * login page does.
 */
export default function FinishSignInPage() {
  const router = useRouter();
  const status = useSession((state) => state.status);
  // The link, captured once: it is stripped from the address bar below.
  const link = useRef<string | null>(null);
  const [phase, setPhase] = useState<'working' | 'askEmail' | 'failed'>('working');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Routing waits for the link to be used: someone already signed in (back
  // from a re-confirm link) would otherwise be sent on before it lands.
  const [signedIn, setSignedIn] = useState(false);

  async function finish(url: string, address: string) {
    setBusy(true);
    setError(null);
    try {
      await completeLink(url, address);
      setSignedIn(true);
    } catch (cause) {
      setError(emailLinkError(cause));
      setPhase((current) => (current === 'askEmail' ? current : 'failed'));
      setBusy(false);
    }
  }

  async function start(href: string) {
    if (!isEmailLink(href)) {
      setPhase('failed');
      setError('This sign-in link is incomplete. Send yourself a new one.');
      return;
    }

    // Restore what the login page knew, in this tab's sessionStorage.
    const { intent, next } = readFinishParams(href);
    if (intent) setLoginIntent(intent);
    if (next) rememberReturnTo(next);

    // The one-time code should not linger in history or be re-submitted.
    window.history.replaceState(null, '', '/login/finish');

    const saved = storedEmail();
    if (saved) await finish(href, saved);
    else setPhase('askEmail');
  }

  useEffect(() => {
    // Once only: the link is gone from the address bar after the first run.
    if (link.current !== null) return;
    link.current = window.location.href;
    void start(link.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    if (status === 'ready') router.replace(returnPath());
    if (status === 'needsProfile') router.replace('/onboarding');
    if (status === 'locked') router.replace('/unlock');
  }, [signedIn, status, router]);

  if (phase === 'working' || signedIn) return <Splash label="Signing in" />;

  return (
    <main className="flex min-h-dvh flex-col justify-center gap-6 bg-void px-6 pt-safe pb-safe">
      {phase === 'askEmail' ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!looksLikeEmail(email)) {
              setError('That doesn’t look like a valid email address.');
              return;
            }
            if (link.current) void finish(link.current, email);
          }}
          className="space-y-4"
        >
          <header>
            <h1 className="text-2xl font-bold tracking-tight">Confirm your email</h1>
            <p className="mt-1.5 text-[14px] text-muted">
              This link was opened on a different device or browser. Enter the address it was
              sent to.
            </p>
          </header>
          <Field
            label="Email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            error={error}
          />
          <Button type="submit" busy={busy} disabled={!email.trim()} className="w-full">
            Continue
          </Button>
        </form>
      ) : (
        <div className="space-y-4">
          <header>
            <h1 className="text-2xl font-bold tracking-tight">Couldn&apos;t sign you in</h1>
            <p className="mt-1.5 text-[14px] text-muted">{error}</p>
          </header>
          <Button onClick={() => router.replace('/login')} className="w-full">
            Send a new link
          </Button>
        </div>
      )}
    </main>
  );
}
