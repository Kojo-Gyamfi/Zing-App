import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/Providers';
import { APPEARANCE_SCRIPT, DEFAULT_APPEARANCE, THEME_COLORS } from '@/lib/appearance';

const sans = Geist({ variable: '--font-sans', subsets: ['latin'] });
// Safety numbers need fixed-width digits to be comparable at a glance.
const mono = Geist_Mono({ variable: '--font-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Zing',
  description: 'Fast, lively, end-to-end encrypted chat.',
  applicationName: 'Zing',
  icons: {
    icon: [{ url: '/icon-32.png', sizes: '32x32', type: 'image/png' }],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
  },
  appleWebApp: {
    capable: true,
    title: 'Zing',
    statusBarStyle: 'black-translucent',
  },
};

export const viewport: Viewport = {
  // The default theme's background; lib/appearance.ts updates it on a switch.
  themeColor: THEME_COLORS.dark,
  // Lets the app paint under the notch and home indicator; the shell then
  // pads itself back with env(safe-area-inset-*).
  viewportFit: 'cover',
  width: 'device-width',
  initialScale: 1,
  // Zoom stays enabled. iOS auto-zooms on focus only when an input is under
  // 16px, so the composer sets its own font size instead of banning pinch.
  userScalable: true,
  // Android Chrome's default (resizes-visual) slides the keyboard over the
  // page without shrinking the layout, so every h-dvh screen keeps its full
  // height and the composer and search boxes end up under the keyboard.
  // resizes-content shrinks the layout instead, and dvh with it. iOS ignores
  // this and scrolls the focused field into view on its own.
  interactiveWidget: 'resizes-content',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Render per request: the CSP nonce from proxy.ts is only stamped onto
  // scripts at request time, so a prerendered page would have its own
  // scripts blocked. Reading the headers is what opts in, and the inline
  // theme script below needs the nonce itself.
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  return (
    // The theme script changes data-theme and data-wallpaper before React
    // hydrates; suppressHydrationWarning lets the DOM keep them.
    <html
      lang="en"
      data-theme="dark"
      data-wallpaper={DEFAULT_APPEARANCE.wallpaper}
      data-text-size={DEFAULT_APPEARANCE.textSize}
      className={`${sans.variable} ${mono.variable} h-full`}
      suppressHydrationWarning
    >
      <head>
        {/* Runs while the HTML is parsed, so a light-theme user never sees a
            dark first frame. See lib/appearance.ts. */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: APPEARANCE_SCRIPT }} />
      </head>
      {/* Browser extensions (Grammarly and the like) add attributes to <body>
          before React loads. This ignores attribute differences on this one
          element only -- mismatches anywhere below still surface. */}
      <body className="min-h-full antialiased font-sans" suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
