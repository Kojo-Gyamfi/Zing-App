'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { isIOS, isStandalone, refreshPush, registerServiceWorker } from '@/lib/push';
import { useSession } from '@/lib/store/session';
import { Button } from '@/components/ui/Button';

type Prompt = Event & { prompt: () => Promise<void> };

const DISMISSED = 'zing.install.dismissed';

/* --- dismissal, as an external store ---------------------------------------
 * Both of the values this banner depends on live outside React and are
 * unavailable during SSR. useSyncExternalStore is the honest way to read them:
 * setting them from an effect instead would render once, then immediately
 * render again.
 */

let dismissedCache: boolean | null = null;
const listeners = new Set<() => void>();

function readDismissed(): boolean {
  if (dismissedCache === null) {
    try {
      dismissedCache = localStorage.getItem(DISMISSED) === '1';
    } catch {
      // Private mode: treat as not dismissed, and the banner returns next visit.
      dismissedCache = false;
    }
  }
  return dismissedCache;
}

function subscribeDismissed(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function dismiss() {
  dismissedCache = true;
  try {
    localStorage.setItem(DISMISSED, '1');
  } catch {
    // Nothing to persist to; the banner just comes back later.
  }
  listeners.forEach((notify) => notify());
}

function subscribeDisplayMode(onChange: () => void) {
  const query = window.matchMedia('(display-mode: standalone)');
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/**
 * Installing is not cosmetic on iOS.
 *
 * Safari evicts IndexedDB after about seven days without a visit, and that
 * store holds the private key -- so an uninstalled Zing quietly locks someone
 * out of their own history until they dig out their passphrase. Home-screen
 * apps are exempt, and push only works there anyway. Hence a prompt with real
 * reasoning in it rather than a generic "install our app".
 */
export function InstallCoach() {
  const user = useSession((state) => state.user);
  const [androidPrompt, setAndroidPrompt] = useState<Prompt | null>(null);

  // Server snapshots return true so nothing renders until the client knows
  // better -- a banner that flashes on every page load would be worse than one
  // that appears a beat late.
  const installed = useSyncExternalStore(subscribeDisplayMode, isStandalone, () => true);
  const dismissed = useSyncExternalStore(subscribeDismissed, readDismissed, () => true);

  useEffect(() => {
    void registerServiceWorker();

    // Chrome fires this instead of showing its own bar; holding onto it lets
    // us trigger the real prompt from our own button.
    const capture = (event: Event) => {
      event.preventDefault();
      setAndroidPrompt(event as Prompt);
    };

    window.addEventListener('beforeinstallprompt', capture);
    return () => window.removeEventListener('beforeinstallprompt', capture);
  }, []);

  // Keep this device's push token current once notifications are on. Asking
  // for permission happens from the chat list banner or Settings, never here.
  const uid = user?.uid;
  useEffect(() => {
    if (uid) void refreshPush(uid);
  }, [uid]);

  if (installed || dismissed) return null;

  return (
    <div className="fixed inset-x-3 bottom-3 z-40 rounded-2xl border border-line bg-elevated p-4 shadow-xl shadow-black/50 md:left-auto md:w-96">
      <div className="flex items-start gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon-192.png" alt="" className="size-11 rounded-xl" />

        <div className="min-w-0 flex-1">
          <p className="font-semibold">Add Zing to your home screen</p>

          {isIOS() ? (
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
              Tap the Share button, then <span className="text-ink">Add to Home Screen</span>. On
              iPhone this is also what stops your encryption key being cleared, and what makes
              notifications possible at all.
            </p>
          ) : (
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
              Opens full screen, works offline, and lets Zing notify you when a message arrives.
            </p>
          )}

          <div className="mt-3 flex gap-2">
            {androidPrompt && (
              <Button
                className="h-10 px-4 text-[14px]"
                onClick={() => {
                  void androidPrompt.prompt();
                  dismiss();
                }}
              >
                Install
              </Button>
            )}
            <button onClick={dismiss} className="h-10 px-3 text-[14px] text-muted">
              Not now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
