'use client';

import { useState } from 'react';
import { useAccount } from '@/lib/store/account';
import { setAppearance } from '@/lib/db/prefs';
import type { TextSize, ThemeChoice, Wallpaper } from '@/lib/appearance';
import { WallpaperPicker } from './WallpaperPicker';

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export const TEXT_SIZE_LABELS: Record<TextSize, string> = {
  small: 'Small',
  default: 'Default',
  large: 'Large',
  xlarge: 'Extra large',
};

// The size each choice previews at: kept in step with app/globals.css.
const PREVIEW_PX: Record<TextSize, number> = { small: 13, default: 15, large: 17.5, xlarge: 20 };

/**
 * Theme and chat wallpaper. Saved on the account doc, so they follow this
 * account to a new phone; AppearanceSync puts them on the page.
 */
export function AppearanceSettings({ uid }: { uid: string }) {
  const known = useAccount((state) => state.known);
  const { theme, wallpaper, textSize } = useAccount((state) => state.settings.appearance);
  const [error, setError] = useState<string | null>(null);

  // Not awaited: the account listener shows the change from the local cache
  // at once, and offline the commit would wait for a reconnect.
  function save(patch: { theme?: ThemeChoice; wallpaper?: Wallpaper; textSize?: TextSize }) {
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

        <div className="space-y-3 p-4">
          <div>
            <p className="text-[14px] font-medium text-ink">Message text size</p>
            <p className="mt-1 text-[12px] leading-relaxed text-faint">
              For messages and the box you type in, on every device you sign in on.
            </p>
          </div>
          <div role="radiogroup" aria-label="Message text size" className="grid grid-cols-4 gap-1.5">
            {(Object.keys(TEXT_SIZE_LABELS) as TextSize[]).map((size) => (
              <button
                key={size}
                role="radio"
                aria-checked={textSize === size}
                aria-label={TEXT_SIZE_LABELS[size]}
                disabled={!known}
                onClick={() => textSize !== size && save({ textSize: size })}
                className={`flex h-14 flex-col items-center justify-center gap-0.5 rounded-xl transition-colors disabled:opacity-50
                  ${textSize === size ? 'bg-zing text-on-zing' : 'bg-elevated text-muted hover:text-ink'}`}
              >
                <span aria-hidden="true" className="leading-none font-semibold" style={{ fontSize: PREVIEW_PX[size] + 2 }}>
                  Aa
                </span>
                <span className="text-[11px] font-medium">{TEXT_SIZE_LABELS[size]}</span>
              </button>
            ))}
          </div>
          {/* A message as it will look: it follows the setting at once. */}
          <div className="rounded-xl bg-elevated p-3">
            <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-bubble-out px-3 py-2 text-(length:--chat-text) leading-snug text-ink">
              See you at 5 — I’ll bring the jollof.
            </p>
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
