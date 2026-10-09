'use client';

import { useEffect, useLayoutEffect } from 'react';
import { applyAppearance, storedAppearance } from '@/lib/appearance';
import { useAccount } from '@/lib/store/account';

/**
 * Keeps <html> in step with the theme and wallpaper on the account doc. The
 * inline script in app/layout.tsx has already applied this device's last
 * choice; this takes over once the doc is read, so a change made on another
 * phone arrives here too. Signed out, the last choice simply stays.
 */
export function AppearanceSync() {
  const ready = useAccount((state) => state.owner !== null && state.known);
  const theme = useAccount((state) => state.settings.appearance.theme);
  const wallpaper = useAccount((state) => state.settings.appearance.wallpaper);

  // Strict Mode's dev remount resets <html> to the attributes React renders,
  // dropping the ones the inline script set. A no-op in production.
  useLayoutEffect(() => applyAppearance(storedAppearance()), []);

  useEffect(() => {
    if (!ready) return;
    const appearance = { theme, wallpaper };
    applyAppearance(appearance);
    if (theme !== 'system') return;
    // "System" follows the phone switching to dark mode at sunset.
    const query = window.matchMedia('(prefers-color-scheme: light)');
    const follow = () => applyAppearance(appearance);
    query.addEventListener('change', follow);
    return () => query.removeEventListener('change', follow);
  }, [ready, theme, wallpaper]);

  return null;
}
