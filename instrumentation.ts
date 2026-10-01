import type { Instrumentation } from 'next';
import { SENTRY_OPTIONS } from '@/lib/monitoring';

/**
 * Server-side error monitoring for the one privileged route (push). Off unless
 * SENTRY_DSN is set. The route handles ciphertext only, and request bodies are
 * stripped before sending anyway.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.SENTRY_DSN) {
    const Sentry = await import('@sentry/nextjs');
    Sentry.init({ dsn: process.env.SENTRY_DSN, ...SENTRY_OPTIONS });
  }
}

export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import('@sentry/nextjs');
  Sentry.captureRequestError(...args);
};
