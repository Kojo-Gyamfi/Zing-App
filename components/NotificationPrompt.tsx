'use client';

import { useEffect, useState } from 'react';
import { useSession } from '@/lib/store/session';
import { enablePush, pushState, type PushState } from '@/lib/push';
import { Button } from '@/components/ui/Button';

const DISMISSED = 'zing.push.prompt.dismissed';

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED) === '1';
  } catch {
    return false;
  }
}

/**
 * "Turn on notifications", above the chat list, for devices that have never
 * been asked. The browser's permission prompt only ever opens from this
 * button: a prompt that appears unprompted gets blocked by reflex, and a
 * blocked site cannot ask again.
 */
export function NotificationPrompt() {
  const uid = useSession((state) => state.user?.uid);
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(wasDismissed);

  useEffect(() => {
    let live = true;
    void pushState().then((next) => {
      if (live) setState(next);
    });
    return () => {
      live = false;
    };
  }, []);

  if (hidden || state !== 'default' || !uid) return null;

  async function turnOn() {
    setBusy(true);
    const outcome = await enablePush(uid!);
    setBusy(false);
    setState(outcome === 'granted' ? 'granted' : outcome === 'denied' ? 'denied' : 'unsupported');
  }

  function dismiss() {
    try {
      localStorage.setItem(DISMISSED, '1');
    } catch {
      // Shows again next launch; harmless.
    }
    setHidden(true);
  }

  return (
    <div className="mx-4 mb-3 rounded-2xl border border-line bg-surface p-4">
      <p className="text-[14px] font-medium text-ink">Get notified about new messages</p>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">
        Previews are decrypted on this phone. Our server only ever forwards ciphertext.
      </p>
      <div className="mt-3 flex gap-2">
        <Button className="h-10 px-4 text-[14px]" onClick={() => void turnOn()} busy={busy}>
          Turn on
        </Button>
        <button onClick={dismiss} className="h-10 px-3 text-[14px] text-muted">
          Not now
        </button>
      </div>
    </div>
  );
}
