/**
 * Error monitoring (Sentry), switched on only when a DSN is configured.
 *
 * The rule that matters: Sentry must never see message text, passphrases,
 * recovery keys or keys. So nothing is sent but the error itself -- no
 * breadcrumbs (they capture clicks, console lines and inputs), no request
 * bodies, no user, no session replay, no performance tracing. Error messages
 * in this codebase never interpolate plaintext; keep it that way.
 */

import type { ErrorEvent } from '@sentry/nextjs';

export const CLIENT_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

/** Shared by the browser and server init. */
export const SENTRY_OPTIONS = {
  sendDefaultPii: false,
  tracesSampleRate: 0,
  maxBreadcrumbs: 0,
  beforeBreadcrumb: () => null,
  beforeSend(event: ErrorEvent): ErrorEvent | null {
    delete event.user;
    delete event.extra;
    delete event.contexts?.state;
    if (event.request) {
      delete event.request.data;
      delete event.request.cookies;
      delete event.request.headers;
      delete event.request.query_string;
    }
    return event;
  },
};

/**
 * Report a caught error. A no-op without a DSN, and never throws: monitoring
 * failing must not become a second error.
 */
export function reportError(error: unknown): void {
  if (!CLIENT_DSN) return;
  void import('@sentry/nextjs')
    .then((Sentry) => Sentry.captureException(error))
    .catch(() => undefined);
}
