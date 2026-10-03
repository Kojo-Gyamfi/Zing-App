'use client';

import { signInWithCustomToken } from 'firebase/auth';
import { auth } from '@/lib/firebase/client';
import type { LoginIntent } from '@/lib/loginIntent';

/**
 * Email sign-in, the browser half: ask the server to email a 6-digit code,
 * then trade the code for a Firebase session. The same on every phone and
 * every email provider, and typed straight into the app -- an iPhone
 * home-screen app included, which a tapped link would have bypassed.
 */

/** Loose on purpose: the code sent to the address is the real check. */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export class EmailCodeError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new EmailCodeError('network');
  }
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new EmailCodeError(String(data.error ?? 'unknown'));
  return data;
}

export async function requestCode(email: string, intent: LoginIntent): Promise<void> {
  await post('/api/auth/email-code/send', { email: email.trim(), intent });
}

/** Signs in on success; the session store routes on from there. */
export async function verifyCode(email: string, code: string): Promise<void> {
  const { token } = await post('/api/auth/email-code/verify', {
    email: email.trim(),
    code: code.trim(),
  });
  await signInWithCustomToken(auth(), String(token));
}

export function emailCodeError(cause: unknown): string {
  const code = cause instanceof EmailCodeError ? cause.code : '';
  switch (code) {
    case 'invalid-email':
      return 'That doesn’t look like a valid email address.';
    case 'no-account':
      return 'No Zing account uses this email. Check it and try again.';
    case 'invalid-code':
      return 'That code isn’t right. Check the email and try again.';
    case 'expired':
      return 'That code has expired. Send yourself a new one.';
    case 'too-many-attempts':
      return 'Too many wrong codes. Send yourself a new one.';
    case 'rate-limited':
      return 'Too many codes asked for. Wait a minute and try again.';
    case 'send-failed':
      return 'We couldn’t send the email. Try again in a moment.';
    default:
      return 'Something went wrong. Check your connection and try again.';
  }
}
