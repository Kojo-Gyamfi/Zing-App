/**
 * What a scanned QR code points at, if it is a Zing profile. Profile codes
 * hold a link to /u/{username} (lib/share.ts) -- from this deployment or
 * another (a dev build scanning a friend's phone) -- or a bare "@username".
 * Anything else is not ours, and nothing is fetched to find out more: a
 * scanned link is never opened on the camera's say-so.
 */
const HANDLE = /^[a-z0-9_]{3,20}$/;

export function usernameFromScan(raw: string): string | null {
  const text = raw.trim();

  if (text.startsWith('@')) {
    const handle = text.slice(1).toLowerCase();
    return HANDLE.test(handle) ? handle : null;
  }

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const match = url.pathname.match(/^\/u\/([^/]+)\/?$/);
  if (!match) return null;
  let handle: string;
  try {
    handle = decodeURIComponent(match[1]).toLowerCase();
  } catch {
    return null;
  }
  return HANDLE.test(handle) ? handle : null;
}
