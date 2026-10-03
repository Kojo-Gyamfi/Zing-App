'use client';

import {
  isSignInWithEmailLink,
  sendSignInLinkToEmail,
  signInWithEmailLink,
} from 'firebase/auth';
import { auth } from '@/lib/firebase/client';
import type { LoginIntent } from '@/lib/loginIntent';
import { finishUrl } from './linkParams';

/**
 * Passwordless email sign-in: the method that works the same on every phone,
 * with no Google or Apple account needed.
 *
 * The link usually comes back in a different tab (tapped in a mail app), so
 * anything the finishing page needs travels in the link itself -- the login
 * intent and return path live in sessionStorage, which a new tab does not
 * share. The address is kept in localStorage so the same browser can finish
 * without asking for it again; another browser has to re-enter it, which is
 * Firebase's guard against a forwarded link signing someone else in.
 */
const EMAIL_KEY = 'zing:emailForSignIn';

export { FINISH_PATH, finishUrl, looksLikeEmail, readFinishParams } from './linkParams';

export async function sendLink(email: string, intent: LoginIntent, next?: string): Promise<void> {
  const address = email.trim();
  await sendSignInLinkToEmail(auth(), address, {
    url: finishUrl(window.location.origin, intent, next),
    handleCodeInApp: true,
  });
  try {
    localStorage.setItem(EMAIL_KEY, address);
  } catch {
    // The finishing page will ask for the address instead.
  }
}

export function storedEmail(): string | null {
  try {
    return localStorage.getItem(EMAIL_KEY);
  } catch {
    return null;
  }
}

export function isEmailLink(url: string): boolean {
  try {
    return isSignInWithEmailLink(auth(), url);
  } catch {
    return false;
  }
}

/**
 * Signs in with a link, whether this page was opened from it or it was
 * pasted in (an iPhone home-screen app has storage of its own, separate from
 * Safari, so a tapped link signs in Safari rather than the app).
 */
export async function completeLink(url: string, email: string): Promise<void> {
  await signInWithEmailLink(auth(), email.trim(), url.trim());
  try {
    localStorage.removeItem(EMAIL_KEY);
  } catch {
    // Harmless leftover.
  }
}

export function emailLinkError(cause: unknown): string {
  const code = (cause as { code?: string }).code ?? '';
  if (code === 'auth/invalid-email') return 'That doesn’t look like a valid email address.';
  if (code === 'auth/invalid-action-code' || code === 'auth/expired-action-code') {
    return 'That link has expired or was already used. Send yourself a new one.';
  }
  if (code === 'auth/too-many-requests' || code === 'auth/quota-exceeded') {
    return 'Too many attempts. Wait a few minutes and try again.';
  }
  if (code === 'auth/operation-not-allowed') return 'Email sign-in isn’t switched on yet.';
  return 'Something went wrong. Check your connection and try again.';
}
