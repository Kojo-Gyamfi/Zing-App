import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Zing',
    short_name: 'Zing',
    description: 'Fast, lively, end-to-end encrypted chat.',
    start_url: '/chats',
    scope: '/',
    display: 'standalone',
    background_color: '#0b0f10',
    theme_color: '#0b0f10',
    orientation: 'portrait',
    categories: ['social', 'communication'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // Android crops this one to its own shape, so it carries extra padding.
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
