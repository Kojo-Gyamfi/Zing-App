'use client';

import { WALLPAPERS, type Wallpaper } from '@/lib/appearance';

export const WALLPAPER_NAMES: Record<Wallpaper, string> = {
  doodles: 'Doodles',
  plain: 'Plain',
  ocean: 'Ocean',
  forest: 'Forest',
  dusk: 'Dusk',
  sand: 'Sand',
};

/**
 * The wallpaper swatches: each a miniature thread on that wallpaper, one
 * bubble each way. Used by Settings (the default for every chat) and by a
 * chat's own menu, which adds a "Default" tile that follows Settings.
 */
export function WallpaperPicker({
  value,
  onChange,
  disabled,
  /** Offer "Default" first: null means "whatever Settings says". */
  fallback,
}: {
  value: Wallpaper | null;
  onChange: (wallpaper: Wallpaper | null) => void;
  disabled?: boolean;
  fallback?: Wallpaper;
}) {
  const choices: (Wallpaper | null)[] = fallback ? [null, ...WALLPAPERS] : [...WALLPAPERS];
  return (
    <div role="radiogroup" aria-label="Chat wallpaper" className="grid grid-cols-3 gap-2">
      {choices.map((choice) => {
        const selected = value === choice;
        const shown = choice ?? fallback!;
        return (
          <button
            key={choice ?? 'default'}
            role="radio"
            aria-checked={selected}
            aria-label={choice ? WALLPAPER_NAMES[choice] : `Default (${WALLPAPER_NAMES[shown]})`}
            disabled={disabled}
            onClick={() => !selected && onChange(choice)}
            className={`overflow-hidden rounded-xl border-2 text-left transition-colors disabled:opacity-50
              ${selected ? 'border-zing' : 'border-line hover:border-muted'}`}
          >
            <span
              data-wallpaper={shown}
              className="chat-wallpaper flex h-16 flex-col justify-center gap-1 px-2"
              aria-hidden="true"
            >
              <span className="h-2.5 w-3/5 rounded-full bg-bubble-in" />
              <span className="h-2.5 w-1/2 self-end rounded-full bg-bubble-out" />
            </span>
            <span
              className={`block truncate px-2 py-1.5 text-[12px] font-medium ${selected ? 'text-zing' : 'text-muted'}`}
              aria-hidden="true"
            >
              {choice ? WALLPAPER_NAMES[choice] : 'Default'}
            </span>
          </button>
        );
      })}
    </div>
  );
}
