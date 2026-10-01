import { NextResponse, type NextRequest } from 'next/server';

/**
 * Content Security Policy, with a fresh nonce per request.
 *
 * The private key sits in IndexedDB as raw bytes, readable by any script on
 * this origin (see lib/crypto/vault.ts). An injected script would defeat the
 * encryption outright, so the CSP is the line that matters most here. Nonces
 * rather than 'unsafe-inline': Next injects inline scripts, and allowing inline
 * wholesale would let an injected one run too.
 *
 * 'strict-dynamic' lets scripts we trust load their own dependencies, which is
 * how Firebase Auth pulls in Google's sign-in scripts and how RTDB's
 * long-polling fallback works, without allowlisting hosts for script-src.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const isDev = process.env.NODE_ENV === 'development';
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
  // Optional services, allowed only when configured.
  const sentry = process.env.NEXT_PUBLIC_SENTRY_DSN
    ? ' https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://*.ingest.de.sentry.io'
    : '';
  // App Check's reCAPTCHA v3: the script itself loads under 'strict-dynamic',
  // but it talks to and frames google.com.
  const recaptcha = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
  const recaptchaConnect = recaptcha ? ' https://www.google.com https://www.gstatic.com' : '';
  const recaptchaFrame = recaptcha ? ' https://www.google.com https://recaptcha.google.com' : '';
  // End-to-end tests only: the local Firebase emulators.
  const emulators =
    process.env.NEXT_PUBLIC_USE_EMULATORS === '1' ? ' http://127.0.0.1:* ws://127.0.0.1:*' : '';

  const csp = `
    default-src 'self';
    script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ''};
    style-src 'self' 'unsafe-inline';
    img-src 'self' blob: data: https://*.googleusercontent.com;
    font-src 'self';
    connect-src 'self' https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://*.firebasedatabase.app wss://*.firebasedatabase.app${sentry}${recaptchaConnect}${emulators};
    frame-src 'self' https://*.firebaseapp.com https://accounts.google.com https://apis.google.com${authDomain ? ` https://${authDomain}` : ''}${recaptchaFrame}${emulators};
    worker-src 'self';
    manifest-src 'self';
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    frame-ancestors 'none';
    ${isDev ? '' : 'upgrade-insecure-requests;'}
  `
    .replace(/\s{2,}/g, ' ')
    .trim();

  // Next reads the nonce from the request's CSP header and stamps it onto
  // every script it renders.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    {
      // Pages only: API routes return JSON, and static files (anything with a
      // dot, including sw.js and the manifest) carry no inline script.
      source: '/((?!api|_next/static|_next/image|.*\\..*).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
