import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ngrok tunnel for testing on a real phone -- dev server only, ignored in production.
  allowedDevOrigins: ['untreacherous-leontine-nonpejoratively.ngrok-free.dev'],

  // Headers that do not vary per request. The CSP needs a per-request nonce,
  // so it lives in proxy.ts instead.
  async headers() {
    return [
      {
        source: '/(.*)',
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
