'use client';

import { useEffect } from 'react';
import { reportError } from '@/lib/monitoring';

/**
 * The last line: the root layout itself failed. This replaces the whole
 * document, so global CSS is not loaded -- the styles are inline, in the
 * app's dark palette.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    reportError(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          padding: '0 32px',
          textAlign: 'center',
          background: '#0b0f10',
          color: '#e8edee',
          fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
        }}
      >
        <title>Zing</title>
        <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Something broke</h1>
        <p style={{ maxWidth: 320, fontSize: 14, lineHeight: 1.6, color: '#8a9a9d', margin: 0 }}>
          Your messages are safe. Reload Zing to carry on.
        </p>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button onClick={() => retry()} style={buttonStyle('#1d2528', '#e8edee')}>
            Try again
          </button>
          <button onClick={() => window.location.reload()} style={buttonStyle('#00cfc1', '#00201d')}>
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}

function buttonStyle(background: string, color: string): React.CSSProperties {
  return {
    height: 44,
    padding: '0 20px',
    border: 0,
    borderRadius: 16,
    background,
    color,
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
  };
}
