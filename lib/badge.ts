/**
 * The number on the installed app's icon (Badging API). Supported by
 * installed PWAs on Chrome/Edge desktop and Android and iOS 16.4+ home-screen
 * apps; everywhere else this does nothing. The service worker keeps it
 * roughly right while the app is closed (public/sw.js); the chat list sets the
 * exact count whenever it is open.
 */
export function setAppBadge(count: number): void {
  if (typeof navigator === 'undefined') return;
  try {
    const done = count > 0 ? navigator.setAppBadge?.(count) : navigator.clearAppBadge?.();
    // Refused without permission (iOS asks with notifications): nothing to do.
    void done?.catch(() => undefined);
  } catch {
    // Not supported here.
  }
}
