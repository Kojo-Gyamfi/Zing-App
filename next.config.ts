import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The end-to-end tests run their own dev server against the Firebase
  // emulators; a separate build dir lets it run beside `npm run dev`.
  distDir: process.env.NEXT_DIST_DIR || '.next',

  // ngrok tunnel for testing on a real phone -- dev server only, ignored in production.
  allowedDevOrigins: ['untreacherous-leontine-nonpejoratively.ngrok-free.dev'],

  // Firebase Auth's sign-in helper, served from our own origin. Safari (and
  // so every iPhone browser) partitions storage per site, which breaks a
  // Google redirect sign-in whose helper lives on *.firebaseapp.com: the
  // person comes back still signed out. With this rewrite in place, set
  // NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN to the app's own domain.
  async rewrites() {
    const project = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    if (!project) return [];
    return [
      {
        source: '/__/auth/:path*',
        destination: `https://${project}.firebaseapp.com/__/auth/:path*`,
      },
    ];
  },

  // Headers that do not vary per request. The CSP needs a per-request nonce,
  // so it lives in proxy.ts instead.
  async headers() {
    return [
      {
        // Not the auth helper: the app frames it (same origin), which DENY
        // would refuse, and Firebase sets its own headers on it.
        source: '/((?!__/auth/).*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          // No includeSubDomains/preload: those commit every subdomain of a
          // future custom domain to HTTPS, which is a decision for later.
          { key: 'Strict-Transport-Security', value: 'max-age=63072000' },
        ],
      },
    ];
  },
};

export default nextConfig;
