import { describe, expect, it } from 'vitest';
import {
  coordinates,
  encodeLocation,
  isLocation,
  LOCATION_LABEL,
  mapsLink,
  parseLocation,
} from './location';
import { plainText } from './formatting';
import { findMatches } from './search';
import { exportAsJson, exportAsText, exportedText, exportFilename } from './export';
import type { DecryptedMessage } from './db/schema';

const accra = { lat: 5.603716, lng: -0.186964, accuracy: 18.4 };

describe('a shared location', () => {
  it('round-trips through the sealed text, rounded sensibly', () => {
    const text = encodeLocation({ lat: 5.6037164321, lng: -0.1869641234, accuracy: 18.4 });
    expect(parseLocation(text)).toEqual({ lat: 5.603716, lng: -0.186964, accuracy: 18 });
    expect(isLocation(text)).toBe(true);
  });

  it('refuses anything that is not one', () => {
    for (const text of [
      'hello',
      'zing-location:not json',
      'zing-location:{"lat":91,"lng":0}',
      'zing-location:{"lat":"x","lng":0}',
      null,
    ]) {
      expect(parseLocation(text)).toBeNull();
    }
  });

  it('reads as "Location" in previews and is never searched', () => {
    const text = encodeLocation(accra);
    expect(plainText(text)).toBe(LOCATION_LABEL);
    const message = { id: 'l', text, deleted: false, viewOnce: false } as DecryptedMessage;
    expect(findMatches([message], 'lat')).toEqual([]);
  });

  it('opens in the maps app of the device', () => {
    expect(mapsLink(accra, 'Mozilla/5.0 (Linux; Android 14)')).toMatch(/^geo:5\.603716,-0\.186964/);
    expect(mapsLink(accra, 'Mozilla/5.0 (iPhone)')).toMatch(/^https:\/\/maps\.apple\.com\//);
    expect(mapsLink(accra, 'Mozilla/5.0 (Windows NT 10.0)')).toMatch(/^https:\/\/www\.google\.com\/maps\//);
    expect(coordinates(accra)).toBe('5.603716, -0.186964');
  });
});

describe('exporting a chat', () => {
  const at = new Date(2026, 9, 12, 9, 5);
  const message = (extra: Partial<DecryptedMessage>): DecryptedMessage => ({
    id: 'm',
    senderId: 'me',
    text: 'hi',
    createdAt: at,
    replyTo: null,
    edited: false,
    deleted: false,
    pending: false,
    ...extra,
  });
  const author = (entry: DecryptedMessage) => (entry.senderId === 'me' ? 'You' : 'Ama');

  it('writes WhatsApp-style lines, and never a view-once text or raw coordinates', () => {
    const file = exportAsText(
      [
        message({ text: 'See you at 5', edited: true }),
        message({ senderId: 'ama', text: 'secret', viewOnce: true }),
        message({ senderId: 'ama', text: encodeLocation(accra) }),
        message({ text: null, deleted: true }),
      ],
      author,
      'Ama',
    );
    expect(file).toContain('[12/10/2026, 09:05] You: See you at 5 (edited)');
    expect(file).toContain('Ama: View once message');
    expect(file).not.toContain('secret');
    expect(file).toContain('Ama: Location: 5.603716, -0.186964');
    expect(file).toContain('You: This message was deleted');
    expect(file).toContain('not encrypted');
  });

  it('keeps structure in JSON, locations as numbers', () => {
    const data = JSON.parse(exportAsJson([message({ text: encodeLocation(accra) })], author, 'Ama'));
    expect(data.messages[0].location).toEqual({ lat: 5.603716, lng: -0.186964, accuracy: 18 });
    expect(data.messages[0].text).toBeNull();
    expect(exportedText(message({ text: 'plain' }))).toBe('plain');
  });

  it('names the file safely', () => {
    expect(exportFilename('Ama / "Work"', 'txt')).toMatch(/^Zing chat with Ama  Work - \d{4}-\d{2}-\d{2}\.txt$/);
  });
});
