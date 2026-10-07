import { ref, onValue, onDisconnect, set, serverTimestamp, remove } from 'firebase/database';
import { rtdb } from '@/lib/firebase/client';

/**
 * Presence and typing live in the Realtime Database, not Firestore.
 *
 * Two reasons. First, onDisconnect(): RTDB can be told in advance what to
 * write when a client's socket drops, which is the only reliable way to mark
 * someone offline when their phone sleeps. Firestore has no equivalent.
 * Second, cost: a keystroke-rate write to Firestore is billable and slow,
 * while these are throwaway signals that nobody needs to persist.
 *
 * Both are unencrypted, and that is fine -- they are booleans and timestamps,
 * the same metadata Firestore already holds. Nothing here reveals content.
 */

export type Presence = { online: boolean; lastSeen: number | null };

/** Call once after sign-in. Returns a teardown for sign-out. */
export function trackPresence(uid: string): (markOffline?: boolean) => void {
  const status = ref(rtdb(), `presence/${uid}`);
  const connected = ref(rtdb(), '.info/connected');

  const stop = onValue(connected, (snapshot) => {
    if (snapshot.val() !== true) return;

    // Registered before going online, so the server still honours it if the
    // connection dies without a clean close.
    void onDisconnect(status)
      .set({ online: false, lastSeen: serverTimestamp() })
      .then(() => set(status, { online: true, lastSeen: serverTimestamp() }))
      // Dropped mid-handshake: the next reconnect runs this again.
      .catch(() => undefined);
  });

  // markOffline false: the account is gone, there is no node left to write.
  return (markOffline = true) => {
    stop();
    if (markOffline) void set(status, { online: false, lastSeen: Date.now() }).catch(() => undefined);
  };
}

export function subscribePresence(uid: string, onChange: (presence: Presence) => void) {
  return onValue(ref(rtdb(), `presence/${uid}`), (snapshot) => {
    const value = snapshot.val() as Presence | null;
    onChange(value ?? { online: false, lastSeen: null });
  });
}

/**
 * Typing is a timestamp rather than a boolean so a client that disappears
 * mid-sentence cannot leave the indicator stuck on forever -- readers ignore
 * anything older than TYPING_TTL.
 */
export const TYPING_TTL = 4000;

export function setTyping(chatId: string, uid: string, typing: boolean): void {
  const node = ref(rtdb(), `typing/${chatId}/${uid}`);
  if (typing) {
    // The server's clock, not this phone's: two phones' clocks can easily be
    // seconds apart, which would hide the indicator or keep it on.
    // Throwaway signals: a failed write just means no indicator.
    void set(node, serverTimestamp()).catch(() => undefined);
    void onDisconnect(node).remove().catch(() => undefined);
  } else {
    void remove(node).catch(() => undefined);
  }
}

/** How far this device's clock is behind the server's, kept current by RTDB. */
let serverOffset = 0;
let watchingOffset = false;

function serverNow(): number {
  if (!watchingOffset) {
    watchingOffset = true;
    onValue(ref(rtdb(), '.info/serverTimeOffset'), (snapshot) => {
      serverOffset = (snapshot.val() as number | null) ?? 0;
    });
  }
  return Date.now() + serverOffset;
}

/**
 * Typing on, then off again TYPING_TTL after the last ping. The node only
 * changes while the peer keeps typing, so the "off" has to come from a timer
 * here -- someone who pauses mid-sentence leaves their last ping in place.
 */
export function subscribeTyping(
  chatId: string,
  peerUid: string,
  onChange: (typing: boolean) => void,
) {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const stop = onValue(ref(rtdb(), `typing/${chatId}/${peerUid}`), (snapshot) => {
    if (timer) clearTimeout(timer);
    timer = null;

    const at = snapshot.val() as number | null;
    const age = at === null ? Infinity : serverNow() - at;
    if (age >= TYPING_TTL) {
      onChange(false);
      return;
    }
    onChange(true);
    timer = setTimeout(() => onChange(false), TYPING_TTL - Math.max(0, age));
  });

  return () => {
    if (timer) clearTimeout(timer);
    stop();
  };
}

/**
 * Account deletion: drop the presence node and the pending onDisconnect write,
 * which would otherwise recreate it the moment this socket closes.
 */
export async function forgetPresence(uid: string): Promise<void> {
  const status = ref(rtdb(), `presence/${uid}`);
  await onDisconnect(status).cancel();
  await remove(status);
}

/**
 * Whether this device can reach Firebase right now. RTDB's own connection
 * flag is the honest signal: navigator.onLine says "a network exists", not
 * "the database is reachable" (captive portals, dead Wi-Fi).
 */
export function subscribeConnection(onChange: (connected: boolean) => void) {
  return onValue(ref(rtdb(), '.info/connected'), (snapshot) => onChange(snapshot.val() === true));
}
