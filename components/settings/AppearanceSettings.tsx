'use client';

import { useState } from 'react';
import { useAccount } from '@/lib/store/account';
import { setAppearance } from '@/lib/db/prefs';
import type { ThemeChoice, Wallpaper } from '@/lib/appearance';
import { WallpaperPicker } from './WallpaperPicker';

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/**
 * Theme and chat wallpaper. Saved on the account doc, so they follow this
 * account to a new phone; AppearanceSync puts them on the page.
 */
export function AppearanceSettings({ uid }: { uid: string }) {
  const known = useAccount((state) => state.known);
  const { theme, wallpaper } = useAccount((state) => state.settings.appearance);
  const [error, setError] = useState<string | null>(null);

  // Not awaited: the account listener shows the change from the local cache
  // at once, and offline the commit would wait for a reconnect.
  function save(patch: { theme?: ThemeChoice; wallpaper?: Wallpaper }) {
    setError(null);
    setAppearance(uid, patch).catch(() =>
      setError('Could not save. Check your connection and try again.'),
    );
  }

  return (
    <div className="space-y-3">
      <div className="divide-y divide-line rounded-2xl border border-line bg-surface">
        <div className="space-y-2.5 p-4">
          <div>
            <p className="text-[14px] font-medium text-ink">Theme</p>
            <p className="mt-1 text-[12px] leading-relaxed text-faint">
              System follows your phone’s dark mode.
            </p>
          </div>
          <div role="radiogroup" aria-label="Theme" className="flex gap-1.5">
            {THEMES.map((choice) => (
              <button
                key={choice.value}
                role="radio"
                aria-checked={theme === choice.value}
                disabled={!known}
                onClick={() => theme !== choice.value && save({ theme: choice.value })}
                className={`h-9 flex-1 rounded-xl text-[13px] font-medium transition-colors disabled:opacity-50
                  ${theme === choice.value ? 'bg-zing text-on-zing' : 'bg-elevated text-muted hover:text-ink'}`}
              >
                {choice.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2.5 p-4">
          <p className="text-[14px] font-medium text-ink">Chat wallpaper</p>
          <WallpaperPicker
            value={wallpaper}
            disabled={!known}
            onChange={(choice) => choice && save({ wallpaper: choice })}
          />
        </div>
      </div>

      {error && <p className="text-[12px] text-danger">{error}</p>}
    </div>
  );
}
