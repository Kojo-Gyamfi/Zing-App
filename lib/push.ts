'use client';

import { getMessaging, getToken, isSupported } from 'firebase/messaging';
import { getApp } from 'firebase/app';
import { registerPushToken } from '@/lib/db/users';

export type PushOutcome = 'granted' | 'denied' | 'unsupported';

/** Registers the worker that both caches the shell and decrypts notifications. */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;

  try {
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch {
    return null;
  }
}

/**
 * Ask for notification permission and register this device with FCM.
 *
 * On iOS this only works once the app has been added to the home screen --
 * Apple gates Web Push on installation, and calling it in a Safari tab throws
 * rather than prompting. The UI checks `isStandalone()` before offering it.
 */
export async function enablePush(uid: string): Promise<PushOutcome> {
  if (!(await isSupported().catch(() => false))) return 'unsupported';
  if (!('Notification' in window)) return 'unsupported';

  const registration = await registerServiceWorker();
  if (!registration) return 'unsupported';

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';

  try {
    const token = await getToken(getMessaging(getApp()), {
      vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY,
      serviceWorkerRegistration: registration,
    });

    if (token) await registerPushToken(uid, token);
    return 'granted';
  } catch {
    return 'unsupported';
  }
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;

  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // Safari's own flag, which predates the standard and is still the only
    // signal on iOS.
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIOS(): boolean {
  if (typeof window === 'undefined') return false;

  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    // iPadOS reports itself as a Mac; the touch point count gives it away.
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}
