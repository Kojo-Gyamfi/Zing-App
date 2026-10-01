import { parsePhoneNumberFromString } from 'libphonenumber-js/min';

/**
 * Phone numbers, in one canonical form.
 *
 * Every number is stored and looked up as E.164 (+233241234567). Before this,
 * "0241234567" and "+233 24 123 4567" were different strings, so one real
 * number could be claimed twice and find-by-phone missed half the spellings.
 *
 * Numbers typed without a country code are read as Ghanaian. The local part --
 * everything after the country code, or everything typed when there is none --
 * may be at most 10 digits.
 */

export const DEFAULT_COUNTRY = 'GH';
export const MAX_LOCAL_DIGITS = 10;
/** The longest a full international number can be (ITU E.164). */
const MAX_INTERNATIONAL_DIGITS = 15;

/** Mirrored by the phones/ and shared/contact rules in firestore.rules. */
export const E164_PATTERN = /^\+[1-9][0-9]{6,14}$/;

const digitsIn = (text: string) => text.replace(/\D/g, '');

/**
 * Canonical form of a typed number. Null for an empty field; throws
 * PHONE_INVALID for anything that is not a real, dialable number.
 */
export function normalizePhone(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;

  const international = text.startsWith('+');
  if (!international && digitsIn(text).length > MAX_LOCAL_DIGITS) throw new Error('PHONE_INVALID');

  const parsed = parsePhoneNumberFromString(text, DEFAULT_COUNTRY);
  if (!parsed || !parsed.isValid() || parsed.nationalNumber.length > MAX_LOCAL_DIGITS) {
    throw new Error('PHONE_INVALID');
  }
  return parsed.number;
}

/** Like normalizePhone, but null instead of throwing -- for searches and old data. */
export function tryNormalizePhone(raw: string): string | null {
  try {
    return normalizePhone(raw);
  } catch {
    return null;
  }
}

/**
 * Keeps a phone field to what could be a number: digits, spaces, dashes and a
 * leading +, and no more than 10 digits unless a country code was typed.
 */
export function limitPhoneInput(value: string): string {
  const international = value.trimStart().startsWith('+');
  const limit = international ? MAX_INTERNATIONAL_DIGITS : MAX_LOCAL_DIGITS;

  let digits = 0;
  let out = international ? '+' : '';
  for (const char of value.trimStart().slice(international ? 1 : 0)) {
    if (/\d/.test(char)) {
      if (digits === limit) break;
      digits += 1;
      out += char;
    } else if (char === ' ' || char === '-') {
      out += char;
    }
  }
  return out;
}

/** For display: local style for Ghanaian numbers (024 123 4567), international otherwise. */
export function formatPhone(e164: string): string {
  const parsed = parsePhoneNumberFromString(e164);
  if (!parsed) return e164;
  return parsed.country === DEFAULT_COUNTRY ? parsed.formatNational() : parsed.formatInternational();
}
