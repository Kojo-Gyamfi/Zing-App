'use client';

import { useMemo } from 'react';
import { encode } from 'uqr';

/**
 * A QR code for a profile link, drawn as one SVG path. Always dark on white
 * whatever the theme: plenty of scanners cannot read a light-on-dark code.
 * Any phone camera opens it, landing on /u/{username} with a Message button.
 */
export function ProfileQr({ url, size = 200 }: { url: string; size?: number }) {
  const { path, modules } = useMemo(() => {
    const qr = encode(url, { ecc: 'M', border: 0 });
    let d = '';
    qr.data.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) d += `M${x} ${y}h1v1h-1z`;
      }),
    );
    return { path: d, modules: qr.size };
  }, [url]);

  // Quiet zone: scanners need a light margin around the code.
  const margin = 3;
  const box = modules + margin * 2;

  return (
    <svg
      viewBox={`${-margin} ${-margin} ${box} ${box}`}
      width={size}
      height={size}
      role="img"
      aria-label={`QR code for ${url}`}
      shapeRendering="crispEdges"
      className="rounded-2xl"
    >
      <rect x={-margin} y={-margin} width={box} height={box} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
