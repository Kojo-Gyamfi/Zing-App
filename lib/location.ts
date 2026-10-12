/**
 * A shared location: coordinates sealed inside the message like any text, so
 * the server cannot tell a location from a "hello" -- not even that one was
 * sent. The plaintext is a marker and JSON; every place that shows message
 * text turns it into a card or a "Location" label instead.
 *
 * Never drawn on a map inline: loading map tiles would tell the tile server
 * where the sender is. The card opens the maps app only when tapped.
 */
const PREFIX = 'zing-location:';

export type SharedLocation = {
  lat: number;
  lng: number;
  /** Metres, as the device reported it. */
  accuracy: number | null;
};

export const LOCATION_LABEL = '📍 Location';

export function encodeLocation(location: SharedLocation): string {
  return (
    PREFIX +
    JSON.stringify({
      lat: Math.round(location.lat * 1e6) / 1e6,
      lng: Math.round(location.lng * 1e6) / 1e6,
      ...(location.accuracy !== null ? { accuracy: Math.round(location.accuracy) } : {}),
    })
  );
}

/** The location in a message's text, or null for anything else. */
export function parseLocation(text: string | null | undefined): SharedLocation | null {
  if (!text?.startsWith(PREFIX)) return null;
  try {
    const raw = JSON.parse(text.slice(PREFIX.length)) as Record<string, unknown>;
    const lat = Number(raw.lat);
    const lng = Number(raw.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return null;
    }
    const accuracy = Number(raw.accuracy);
    return { lat, lng, accuracy: Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : null };
  } catch {
    return null;
  }
}

export function isLocation(text: string | null | undefined): boolean {
  return parseLocation(text) !== null;
}

/** "5.603716, -0.186964": what Copy and an export give for a location. */
export function coordinates(location: SharedLocation): string {
  return `${location.lat.toFixed(6)}, ${location.lng.toFixed(6)}`;
}

/** A link that opens the device's maps app on this spot. */
export function mapsLink(location: SharedLocation, platform = typeof navigator === 'undefined' ? '' : navigator.userAgent): string {
  const at = `${location.lat},${location.lng}`;
  if (/iPhone|iPad|Macintosh/.test(platform)) return `https://maps.apple.com/?ll=${at}&q=${at}`;
  if (/Android/.test(platform)) return `geo:${at}?q=${at}`;
  return `https://www.google.com/maps/search/?api=1&query=${at}`;
}

/** How a message reads in one line (previews, quotes, notifications). */
export function previewText(text: string): string {
  return isLocation(text) ? LOCATION_LABEL : text;
}
