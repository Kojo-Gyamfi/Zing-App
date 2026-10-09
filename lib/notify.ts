'use client';

import { auth } from '@/lib/firebase/client';
import type { Envelope } from '@/lib/crypto/types';

/**
 * Ask the server to push this message to the other members' devices.
 *
 * It forwards the ciphertext untouched -- the server has no key -- and the
 * recipient's service worker decrypts it locally to build the notification.
 *
 * Best-effort by design: a failure here means someone misses a buzz, not a
 * lost message, so it never blocks or surfaces an error.
 */
export async function notifyPeers(
  chatId: string,
  envelope: Envelope,
  /** A view-once message: the server pushes a label, never the ciphertext. */
  viewOnce = false,
): Promise<void> {
  const user = auth().currentUser;
  if (!user) return;

  try {
    await fetch('/api/push/send', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${await user.getIdToken()}`,
      },
      body: JSON.stringify({ chatId, ...envelope, ...(viewOnce ? { viewOnce: true } : {}) }),
    });
  } catch {
    // Offline, or push not configured yet.
  }
}
