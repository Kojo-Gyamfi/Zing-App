/**
 * Nicknames: a name for someone that only this user sees ("Mum" instead of
 * whatever they call themselves). Kept on the owner's account doc as
 * `nicknames.{uid}`, so the other person never knows. Shown wherever their
 * name would be; their real display name stays on their profile.
 */
export const MAX_NICKNAME = 40;

/** Trimmed and capped, or null for "no nickname". */
export function cleanNickname(raw: string): string | null {
  const name = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_NICKNAME);
  return name || null;
}

/** The nicknames map from Firestore, with anything malformed dropped. */
export function toNicknames(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {};
  const names: Record<string, string> = {};
  for (const [uid, raw] of Object.entries(value as Record<string, unknown>)) {
    const name = typeof raw === 'string' ? cleanNickname(raw) : null;
    if (name) names[uid] = name;
  }
  return names;
}

/** What to call someone: my nickname for them, else their own name. */
export function nameFor(
  person: { uid: string; displayName: string } | null | undefined,
  nicknames: Record<string, string>,
  fallback: string,
): string {
  if (!person) return fallback;
  return nicknames[person.uid] ?? person.displayName;
}
