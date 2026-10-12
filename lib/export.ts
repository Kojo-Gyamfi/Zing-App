import type { DecryptedMessage } from '@/lib/db/schema';
import { coordinates, mapsLink, parseLocation } from './location';
import { VIEW_ONCE_LABEL } from './viewOnce';

/**
 * "Export chat": one conversation as a file, built on this device from the
 * messages it decrypted. The server is never involved -- and the file is
 * plain, unencrypted text, which is why the UI says so before saving it.
 */
export type ExportFormat = 'txt' | 'json';

/** How a message reads in an export: never raw coordinates or a view-once text. */
export function exportedText(message: DecryptedMessage): string {
  if (message.deleted) return 'This message was deleted';
  if (message.viewOnce) return VIEW_ONCE_LABEL;
  if (message.text === null) return "Can't be decrypted on this device";
  const location = parseLocation(message.text);
  if (location) return `Location: ${coordinates(location)} (${mapsLink(location, '')})`;
  return message.text;
}

function stamp(date: Date | null): string {
  if (!date) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** WhatsApp's own export shape: "[09/10/2026, 14:32] Ama: See you at 5". */
export function exportAsText(
  messages: DecryptedMessage[],
  authorOf: (message: DecryptedMessage) => string,
  title: string,
): string {
  const lines = [
    `Zing chat: ${title}`,
    `Exported ${stamp(new Date())}. This file is not encrypted — keep it somewhere private.`,
    '',
  ];
  for (const message of messages) {
    const extras = [message.forwarded ? 'forwarded' : null, message.edited ? 'edited' : null].filter(Boolean);
    lines.push(
      `[${stamp(message.createdAt)}] ${authorOf(message)}: ${exportedText(message)}${
        extras.length ? ` (${extras.join(', ')})` : ''
      }`,
    );
  }
  return lines.join('\n') + '\n';
}

export function exportAsJson(
  messages: DecryptedMessage[],
  authorOf: (message: DecryptedMessage) => string,
  title: string,
): string {
  return JSON.stringify(
    {
      chat: title,
      exportedAt: new Date().toISOString(),
      note: 'This file is not encrypted.',
      messages: messages.map((message) => {
        const location = message.deleted || message.viewOnce ? null : parseLocation(message.text);
        return {
          id: message.id,
          sentAt: message.createdAt?.toISOString() ?? null,
          from: authorOf(message),
          text: location ? null : exportedText(message),
          ...(location ? { location: { lat: location.lat, lng: location.lng, accuracy: location.accuracy } } : {}),
          ...(message.replyTo ? { replyTo: message.replyTo } : {}),
          ...(message.forwarded ? { forwarded: true } : {}),
          ...(message.edited ? { edited: true } : {}),
          ...(message.deleted ? { deleted: true } : {}),
          ...(message.viewOnce ? { viewOnce: true } : {}),
        };
      }),
    },
    null,
    2,
  );
}

/** Hand the file to the browser to save. In the page, revoked a moment later: Safari needs both. */
export function download(contents: string, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** "Zing chat with Ama - 2026-10-12.txt", safe on every file system. */
export function exportFilename(title: string, format: ExportFormat): string {
  const safe = title.replace(/[\\/:*?"<>|]+/g, '').trim() || 'chat';
  return `Zing chat with ${safe} - ${new Date().toISOString().slice(0, 10)}.${format}`;
}

// The last chat collected for export, decrypted, in memory only. Exporting it
// again soon after (the other format, a second tap) reuses it instead of
// reading every message from the server again: an export of a long chat is
// thousands of billed reads. One chat at a time, and dropped at sign-out.
const REUSE_MS = 2 * 60_000;
let lastCollected: { key: string; at: number; messages: DecryptedMessage[] } | null = null;

/** The messages to export: the copy from the last two minutes, or `load()`'s. */
export async function collectForExport(
  key: string,
  load: () => Promise<DecryptedMessage[]>,
): Promise<DecryptedMessage[]> {
  if (lastCollected?.key === key && Date.now() - lastCollected.at < REUSE_MS) return lastCollected.messages;
  lastCollected = null;
  const messages = await load();
  lastCollected = { key, at: Date.now(), messages };
  return messages;
}

export function forgetExports(): void {
  lastCollected = null;
}
