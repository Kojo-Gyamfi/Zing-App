'use client';

import { useEffect, useState } from 'react';
import {
  enablePush,
  isIOS,
  isPushPaused,
  pushState,
  setPushPaused,
  showTestNotification,
  type PushState,
} from '@/lib/push';
import { loadNotificationPreviews, saveNotificationPreviews } from '@/lib/crypto/vault';
import { Toggle } from './Toggle';

export type NotificationStatus = PushState | 'off' | null;

/**
 * Where notifications stand on this device: the browser's permission, and
 * whether they were switched off here. Null while checking.
 */
export function useNotificationStatus(uid: string) {
  const [state, setState] = useState<PushState | null>(null);
  const [paused, setPaused] = useState(() => isPushPaused(uid));
  useEffect(() => {
    let live = true;
    void pushState().then((next) => live && setState(next));
    return () => {
      live = false;
    };
  }, []);
  const status: NotificationStatus = state === 'granted' && paused ? 'off' : state;
  return { status, state, setState, paused, setPaused };
}

export function notificationSummary(status: NotificationStatus): string {
  switch (status) {
    case null:
      return 'Checking…';
    case 'granted':
      return 'On for this device';
    case 'off':
      return 'Off for this device';
    case 'denied':
      return 'Blocked in this browser';
    case 'default':
      return 'Not turned on yet';
    default:
      return 'Not available here';
  }
}

/**
 * Notifications for this device: on or off, previews or not, and a test.
 * A page cannot take back the browser's permission, so "off" unregisters this
 * device instead (lib/push.ts setPushPaused); blocked notifications can only
 * be let back in from the browser's own site settings, so it says how.
 */
export function NotificationSettings({
  uid,
  notifications,
}: {
  uid: string;
  notifications: ReturnType<typeof useNotificationStatus>;
}) {
  const { status, setState, paused, setPaused } = notifications;
  const [busy, setBusy] = useState(false);
  const [previews, setPreviews] = useState<boolean | null>(null);
  const [tested, setTested] = useState<'sent' | 'failed' | null>(null);

  useEffect(() => {
    let live = true;
    void loadNotificationPreviews()
      .then((on) => live && setPreviews(on))
      .catch(() => live && setPreviews(true));
    return () => {
      live = false;
    };
  }, []);

  async function turnOn() {
    setBusy(true);
    const outcome = paused ? await setPushPaused(uid, false) : await enablePush(uid);
    setBusy(false);
    setPaused(false);
    setState(outcome === 'granted' ? 'granted' : outcome === 'denied' ? 'denied' : 'unsupported');
  }

  async function turnOff() {
    setBusy(true);
    await setPushPaused(uid, true).catch(() => undefined);
    setBusy(false);
    setPaused(true);
  }

  async function test() {
    setTested((await showTestNotification()) ? 'sent' : 'failed');
    setTimeout(() => setTested(null), 4000);
  }

  const on = status === 'granted';
  const canSwitch = status === 'granted' || status === 'off' || status === 'default';

  return (
    <div className="divide-y divide-line rounded-2xl border border-line bg-surface">
      <div className="p-4">
        {canSwitch ? (
          <Toggle
            label="Message notifications"
            hint={
              on
                ? 'This device buzzes when a message arrives. The preview is decrypted here — the server only forwards ciphertext.'
                : status === 'off'
                  ? 'Off on this device. Messages still arrive; you just won’t be buzzed.'
                  : 'Get a notification on this device when someone messages you.'
            }
            on={on}
            disabled={busy}
            onChange={(next) => void (next ? turnOn() : turnOff())}
            bare
          />
        ) : (
          <div>
            <p className="text-[14px] font-medium text-ink">Message notifications</p>
            <p className="mt-1 text-[12px] leading-relaxed text-faint">
              {status === null
                ? 'Checking…'
                : status === 'denied'
                  ? 'Blocked for Zing in this browser. Tap the icon beside the address bar (or open site settings), allow Notifications, then reload.'
                  : isIOS()
                    ? 'On iPhone, add Zing to your Home Screen first (Share → Add to Home Screen), then turn them on from the installed app.'
                    : 'This browser cannot show notifications.'}
            </p>
          </div>
        )}
      </div>

      {(on || status === 'off') && (
        <div className="p-4">
          <Toggle
            label="Show message previews"
            hint="Off: notifications on this device say only “New message”, for a lock screen other people can see. Muted chats never notify at all."
            on={previews !== false}
            disabled={previews === null}
            onChange={(next) => {
              setPreviews(next);
              void saveNotificationPreviews(next).catch(() => setPreviews(!next));
            }}
            bare
          />
        </div>
      )}

      {on && (
        <div className="flex items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="text-[14px] font-medium text-ink">Test notification</p>
            <p className="mt-1 text-[12px] text-faint">
              {tested === 'sent'
                ? 'Sent. If nothing showed, check your phone’s notification settings for this browser.'
                : tested === 'failed'
                  ? 'Couldn’t show one. Reload Zing and try again.'
                  : 'Check that they get through on this device.'}
            </p>
          </div>
          <button
            onClick={() => void test()}
            className="h-9 shrink-0 rounded-full bg-elevated px-4 text-[13px] font-medium text-zing"
          >
            Send test
          </button>
        </div>
      )}
    </div>
  );
}
