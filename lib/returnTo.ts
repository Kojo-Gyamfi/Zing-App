'use client';

/**
 * Where to go once the session is ready.
 *
 * Opening a shared profile link while signed out bounces through /login (and
 * possibly /unlock or /onboarding). Without this the link is lost on the way
 * and the person lands on the chat list instead of the profile they opened.
 *
 * sessionStorage, so it survives Google's sign-in redirect in the same tab
 * but not into unrelated later visits.
 */
const KEY = 'zing:returnTo';

export function rememberReturnTo(path: string): void {
  // Same-origin paths only: "//evil.example" would be an open redirect.
  if (!path.startsWith('/') || path.startsWith('//')) return;
  try {
    sessionStorage.setItem(KEY, path);
  } catch {
    // Storage blocked; the person just lands on the chat list.
  }
}

/**
 * Falls back to the chat list. Reading does not clear it: the auth pages can
 * redirect twice in one transition (an explicit replace plus the status
 * effect), and both must agree. The app layout clears it on arrival.
 */
export function returnPath(): string {
  try {
    const path = sessionStorage.getItem(KEY);
    if (path && path.startsWith('/') && !path.startsWith('//')) return path;
  } catch {
    // Fall through.
  }
  return '/chats';
}

export function clearReturnTo(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
