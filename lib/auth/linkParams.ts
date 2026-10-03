import type { LoginIntent } from '@/lib/loginIntent';

/**
 * The pure half of email-link sign-in (see emailLink.ts): what the emailed
 * link carries, with no Firebase in sight so it can be unit tested.
 */

export const FINISH_PATH = '/login/finish';

/** Loose on purpose: the email itself is the real check. */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** Same-origin paths only: "//evil.example" would be an open redirect. */
function isSafePath(path: string | null): path is string {
  return !!path && path.startsWith('/') && !path.startsWith('//');
}

/** The URL the emailed link lands on, carrying intent and return path. */
export function finishUrl(origin: string, intent: LoginIntent, next?: string): string {
  const url = new URL(FINISH_PATH, origin);
  url.searchParams.set('intent', intent);
  if (next && isSafePath(next)) url.searchParams.set('next', next);
  return url.toString();
}

/** Reads back what finishUrl put in. Unknown or unsafe values are dropped. */
export function readFinishParams(href: string): { intent: LoginIntent | null; next: string | null } {
  let params: URLSearchParams;
  try {
    params = new URL(href).searchParams;
  } catch {
    return { intent: null, next: null };
  }
  // Firebase wraps our URL in its own as `continueUrl` when the link has
  // been through its action handler; look there too.
  const continueUrl = params.get('continueUrl');
  if (continueUrl && !params.has('intent')) return readFinishParams(continueUrl);

  const intent = params.get('intent');
  const next = params.get('next');
  return {
    intent: intent === 'signup' || intent === 'signin' ? intent : null,
    next: isSafePath(next) ? next : null,
  };
}
