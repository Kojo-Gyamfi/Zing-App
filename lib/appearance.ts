/**
 * Theme and chat wallpaper. The choice is saved on the account doc so it
 * follows the user to a new phone, and mirrored to localStorage so the inline
 * script in app/layout.tsx can apply it before the first paint -- the account
 * doc only arrives after Firebase has loaded, which would flash the default.
 *
 * Both end up as attributes on <html>: data-theme (always resolved to light
 * or dark) and data-wallpaper. app/globals.css does the rest.
 */

export type ThemeChoice = 'system' | 'light' | 'dark';

export const WALLPAPERS = ['doodles', 'plain', 'ocean', 'forest', 'dusk', 'sand'] as const;
export type Wallpaper = (typeof WALLPAPERS)[number];

export type Appearance = { theme: ThemeChoice; wallpaper: Wallpaper };

/** Zing was dark-only before this existed; existing users keep that look. */
export const DEFAULT_APPEARANCE: Appearance = { theme: 'dark', wallpaper: 'doodles' };

export const STORAGE_KEY = 'zing:appearance';

/** The browser bar colour per theme: the app background. */
export const THEME_COLORS = { dark: '#0b0f10', light: '#f2f5f5' } as const;

/** Anything read back from storage or Firestore, with bad values dropped. */
export function toAppearance(value: unknown): Appearance {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<Record<string, unknown>>;
  const theme = ['system', 'light', 'dark'].includes(raw.theme as string)
    ? (raw.theme as ThemeChoice)
    : DEFAULT_APPEARANCE.theme;
  const wallpaper = (WALLPAPERS as readonly string[]).includes(raw.wallpaper as string)
    ? (raw.wallpaper as Wallpaper)
    : DEFAULT_APPEARANCE.wallpaper;
  return { theme, wallpaper };
}

/**
 * The script the root layout inlines into <head>. It must stay small and
 * self-contained, and agree with applyAppearance below.
 */
export const APPEARANCE_SCRIPT = `(function(){try{var a=JSON.parse(localStorage.getItem(${JSON.stringify(
  STORAGE_KEY,
)})||"{}"),t=a.theme,d=document.documentElement;if(t==="system")t=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";if(t==="light"||t==="dark")d.setAttribute("data-theme",t);if(typeof a.wallpaper==="string")d.setAttribute("data-wallpaper",a.wallpaper)}catch(e){}})()`;

export function resolveTheme(theme: ThemeChoice): 'light' | 'dark' {
  if (theme !== 'system') return theme;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/** Put a choice on the page, and remember it for the next first paint. */
export function applyAppearance(appearance: Appearance): void {
  const root = document.documentElement;
  const theme = resolveTheme(appearance.theme);
  root.setAttribute('data-theme', theme);
  root.setAttribute('data-wallpaper', appearance.wallpaper);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme]);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appearance));
  } catch {
    // Private mode: the next load paints the default first, then corrects.
  }
}

/** What this device last applied, for before the account doc has loaded. */
export function storedAppearance(): Appearance {
  try {
    return toAppearance(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'));
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

/**
 * Per-chat theme: a wallpaper and an outgoing-bubble colour for one
 * conversation, overriding the defaults above. Kept on the owner's account
 * doc (chatThemes.{chatId}) -- the other person never sees it. Teal is the
 * app's own bubble colour, so it needs no attribute; the rest are
 * data-bubble values in app/globals.css.
 */
export const BUBBLES = ['teal', 'blue', 'green', 'purple', 'rose', 'amber'] as const;
export type BubbleColor = (typeof BUBBLES)[number];

export type ChatTheme = { wallpaper?: Wallpaper; bubble?: BubbleColor };

/** Swatch colours for the bubble picker, matching the hues in globals.css. */
export const BUBBLE_SWATCHES: Record<BubbleColor, string> = {
  teal: '#00cfc1',
  blue: '#2f7fd8',
  green: '#2e9b5f',
  purple: '#8a5cd6',
  rose: '#d6537a',
  amber: '#d99a2b',
};

/** The chatThemes map from Firestore, with anything unrecognised dropped. */
export function toChatThemes(value: unknown): Record<string, ChatTheme> {
  if (!value || typeof value !== 'object') return {};
  const themes: Record<string, ChatTheme> = {};
  for (const [chatId, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    const { wallpaper, bubble } = raw as Record<string, unknown>;
    const theme: ChatTheme = {};
    if ((WALLPAPERS as readonly string[]).includes(wallpaper as string)) {
      theme.wallpaper = wallpaper as Wallpaper;
    }
    if ((BUBBLES as readonly string[]).includes(bubble as string)) theme.bubble = bubble as BubbleColor;
    if (theme.wallpaper || theme.bubble) themes[chatId] = theme;
  }
  return themes;
}
