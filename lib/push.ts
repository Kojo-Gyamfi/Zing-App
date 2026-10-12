'use client';

import { deleteToken, getMessaging, getToken, isSupported } from 'firebase/messaging';
import { getApp } from 'firebase/app';
import { registerPushToken, unregisterPushToken } from '@/lib/db/users';

export type PushOutcome = 'granted' | 'denied' | 'unsupported';

/**
 * What this device can do about notifications right now:
 *   unsupported -- no Web Push here (or iOS outside a home-screen app)
 *   default     -- never asked; the app may offer to turn them on
 *   granted     -- on
 *   denied      -- blocked in the browser; only the user can undo that
 */
export type PushState = 'unsupported' | NotificationPermission;

export async function pushState(): Promise<PushState> {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  if (!('serviceWorker' in navigator)) return 'unsupported';
  // Apple only allows Web Push for apps added to the home screen.
  if (isIOS() && !isStandalone()) return 'unsupported';
  if (!(await isSupported().catch(() => false))) return 'unsupported';
  return Notification.permission;
}

/**
 * Re-register on launch when permission was already given. Never prompts:
 * asking out of nowhere gets a reflexive "Block", and Chrome then hides the
 * prompt for good. Asking happens only from a button (enablePush).
 */
export async function refreshPush(uid: string): Promise<void> {
  if (isPushPaused(uid)) return;
  if ((await pushState()) === 'granted') await enablePush(uid);
}

/**
 * Notifications switched off in Settings, on this device, for this account.
 * A page cannot take back the browser's permission, so "off" is this device
 * unregistering its token -- the server then has nowhere to send -- and
 * remembering not to register again on the next launch.
 */
const PAUSED = 'zing.push.off:';

export function isPushPaused(uid: string): boolean {
  try {
    return localStorage.getItem(PAUSED + uid) === '1';
  } catch {
    return false;
  }
}

export async function setPushPaused(uid: string, paused: boolean): Promise<PushOutcome> {
  try {
    if (paused) localStorage.setItem(PAUSED + uid, '1');
    else localStorage.removeItem(PAUSED + uid);
  } catch {
    // Private mode: on or off still takes effect now, just not remembered.
  }
  if (paused) {
    await disablePush(uid);
    return 'granted';
  }
  return enablePush(uid);
}

/** A notification from this device to itself, to check they get through. */
export async function showTestNotification(): Promise<boolean> {
  try {
    const registration = await navigator.serviceWorker.getRegistration('/');
    if (!registration || Notification.permission !== 'granted') return false;
    await registration.showNotification('Zing', {
      body: 'Notifications are working on this device.',
      tag: 'zing-test',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Stop this device receiving the account's notifications. Called on sign-out,
 * or the next person to use this browser would get the previous account's
 * messages buzzing their phone.
 */
export async function disablePush(uid: string): Promise<void> {
  const registered = readRegistered();
  const token = registered?.startsWith(`${uid}:`) ? registered.slice(uid.length + 1) : null;
  if (!token) {
    clearRegistered();
    return;
  }

  const results = await Promise.allSettled([unregisterPushToken(uid, token), revokeToken()]);
  // Kept when either failed (offline, say): the next account to turn push on
  // here sees it belongs to someone else and gets a fresh token, rather than
  // sharing one that still delivers the previous account's messages.
  if (results.every((result) => result.status === 'fulfilled')) clearRegistered();
}

/**
 * Tell FCM to forget this browser's token. Messaging must be pointed at OUR
 * worker first: left to itself, deleteToken() goes looking for a default
 * /firebase-messaging-sw.js, gets a 404, and fails without revoking anything.
 * getToken() with our registration returns the existing token and wires that up.
 */
async function revokeToken(): Promise<void> {
  if (!(await isSupported().catch(() => false))) return;
  if (Notification.permission !== 'granted') return;

  const registration = await navigator.serviceWorker.getRegistration('/');
  if (!registration) return;

  const messaging = getMessaging(getApp());
  await getToken(messaging, {
    vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY,
    serviceWorkerRegistration: registration,
  });
  await deleteToken(messaging);
}

/** Opening a chat clears its notifications, like WhatsApp. */
export async function clearChatNotifications(chatId: string): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const open = (await registration?.getNotifications({ tag: chatId })) ?? [];
    open.forEach((notification) => notification.close());
  } catch {
    // Nothing to clear.
  }
}

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

  // Throws instead of prompting in an iOS Safari tab; a throw here would leave
  // the "Turn on" button spinning, so it counts as unsupported.
  const permission = await Notification.requestPermission().catch(() => null);
  if (permission === null) return 'unsupported';
  if (permission !== 'granted') return 'denied';

  try {
    const messaging = getMessaging(getApp());
    const options = {
      vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY,
      serviceWorkerRegistration: registration,
    };
    // A token another account registered here, never unregistered (signed out
    // offline): revoke it first, so this account's token is a new one.
    const previous = readRegistered();
    if (previous && !previous.startsWith(`${uid}:`)) {
      await getToken(messaging, options).then(() => deleteToken(messaging)).catch(() => undefined);
      clearRegistered();
    }
    const token = await getToken(messaging, options);

    // Installed apps call this on every launch; only write when the token or
    // the account on this device has changed.
    const registered = `${uid}:${token}`;
    if (token && readRegistered() !== registered) {
      await registerPushToken(uid, token);
      writeRegistered(registered);
    }
    return 'granted';
  } catch {
    return 'unsupported';
  }
}

const REGISTERED = 'zing.push.registered';

function readRegistered(): string | null {
  try {
    return localStorage.getItem(REGISTERED);
  } catch {
    return null;
  }
}

function writeRegistered(value: string) {
  try {
    localStorage.setItem(REGISTERED, value);
  } catch {
    // Storage blocked: we just re-register next launch.
  }
}

function clearRegistered() {
  try {
    localStorage.removeItem(REGISTERED);
  } catch {
    // Nothing stored.
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
