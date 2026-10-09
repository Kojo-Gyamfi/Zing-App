'use client';

import { useEffect } from 'react';
import { saveNicknames } from '@/lib/crypto/vault';
import { useAccount } from '@/lib/store/account';

/**
 * Copies my nicknames to this device's IndexedDB, where the service worker
 * reads them for notification titles: a push names the sender only by their
 * public name, since a nickname is private and must not go through FCM.
 * Sign-out clears the copy with the key (clearIdentity).
 */
export function NicknameCache() {
  const ready = useAccount((state) => state.owner !== null && state.known);
  const nicknames = useAccount((state) => state.settings.nicknames);

  useEffect(() => {
    if (ready) void saveNicknames(nicknames).catch(() => undefined);
  }, [ready, nicknames]);

  return null;
}
