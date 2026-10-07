/**
 * Links in messages, and the preview card under them.
 *
 * Previews are built from the URL alone, on whichever device shows them.
 * Fetching the page for a title and image would need a server (browsers
 * cannot read other sites' pages), and that server would learn every link
 * anyone sends -- message content, in plain sight. The URL is already inside
 * the encrypted message, so a card made from it costs no request and tells
 * nobody anything.
 */

export type TextRun = { text: string; href?: string };

// http(s) URLs and bare www. addresses, up to whitespace or a closing angle
// bracket. Trailing punctuation is trimmed below: "see example.com." should
// not link the full stop.
const LINK = /\b(?:https?:\/\/|www\.)[^\s<>]+/gi;
const TRAILING = /[.,;:!?'"”’)\]]+$/;

/** The text split into plain runs and links. Only http(s) ever becomes a link. */
export function splitLinks(text: string): TextRun[] {
  const runs: TextRun[] = [];
  let from = 0;
  for (const match of text.matchAll(LINK)) {
    let raw = match[0];
    // Keep a closing bracket that closes one inside the URL (Wikipedia links).
    const trailing = raw.match(TRAILING)?.[0] ?? '';
    let cut = trailing.length;
    if (trailing.startsWith(')') && raw.slice(0, -cut).includes('(')) cut = trailing.length - 1;
    raw = raw.slice(0, raw.length - cut);

    const href = toHref(raw);
    if (!href) continue;
    const at = match.index;
    if (at > from) runs.push({ text: text.slice(from, at) });
    runs.push({ text: raw, href });
    from = at + raw.length;
  }
  if (from < text.length) runs.push({ text: text.slice(from) });
  return runs.length ? runs : [{ text }];
}

function toHref(raw: string): string | null {
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname.includes('.')) return null;
    return url.href;
  } catch {
    return null;
  }
}

export type LinkCard = {
  href: string;
  /**
   * Where it really goes. URL parsing turns look-alike Unicode hosts into
   * punycode ("xn--pple-43d.com"), so a disguised address shows as one.
   */
  host: string;
  /** A best guess at a title, from the path; the host when there is none. */
  title: string;
  /** Recognised sites get a label of their own. */
  kind: 'video' | 'code' | 'map' | 'link';
};

/** The card for the first link in a message, or null when it has none. */
export function firstLinkCard(text: string): LinkCard | null {
  const href = splitLinks(text).find((run) => run.href)?.href;
  return href ? linkCard(href) : null;
}

export function linkCard(href: string): LinkCard {
  const url = new URL(href);
  const host = url.hostname.replace(/^www\./, '');
  const segments = url.pathname.split('/').filter(Boolean).map(safeDecode);

  if (host === 'youtu.be' || host.endsWith('youtube.com')) {
    return { href, host, title: 'YouTube video', kind: 'video' };
  }
  if (host === 'github.com' && segments.length >= 2) {
    return { href, host, title: `${segments[0]}/${segments[1]}`, kind: 'code' };
  }
  if (host.startsWith('maps.') || (host.startsWith('google.') && segments[0] === 'maps')) {
    return { href, host, title: 'Location on a map', kind: 'map' };
  }

  // The last path segment that reads like words: "/2026/10/how-to-cook-jollof.html".
  const words = [...segments]
    .reverse()
    .map((segment) => segment.replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[-_+]+/g, ' ').trim())
    .find((segment) => /[a-z]{3,}/i.test(segment) && !/^[a-z0-9]{16,}$/i.test(segment));
  const title = words ? words.charAt(0).toUpperCase() + words.slice(1) : host;

  return { href, host, title: title.length > 80 ? `${title.slice(0, 79)}…` : title, kind: 'link' };
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
