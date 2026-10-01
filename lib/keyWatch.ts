'use client';

/**
 * Remembers each contact's public key on this device, so a change can be
 * flagged in the chat -- the same job as Signal's "safety number changed".
 *
 * The rules forbid anyone changing users/{uid}.publicKey, so in normal use
 * this never fires. It exists for the case the rules cannot cover: whoever
 * controls the Firebase project (or Google) swapping a key to read new
 * messages. A warning on screen is what turns that from silent into visible.
 *
 * Trust on first use: the first key seen for someone is accepted as theirs.
 * Comparing safety numbers in person ("Verify encryption") is how to check it.
 */

const STORE = 'zing.peerKeys';

type Known = Record<string, string>;

function read(): Known {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORE) ?? '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Known) : {};
  } catch {
    return {};
  }
}

function write(known: Known) {
  try {
    localStorage.setItem(STORE, JSON.stringify(known));
  } catch {
    // No storage: every key looks new each launch, which never warns.
  }
}

/** True when this contact's key differs from the one seen before. Records it if new. */
export function peerKeyChanged(uid: string, publicKey: string): boolean {
  const known = read();
  if (!known[uid]) {
    write({ ...known, [uid]: publicKey });
    return false;
  }
  return known[uid] !== publicKey;
}

/** The person has seen the warning and accepts the new key. */
export function acceptPeerKey(uid: string, publicKey: string): void {
  write({ ...read(), [uid]: publicKey });
}
