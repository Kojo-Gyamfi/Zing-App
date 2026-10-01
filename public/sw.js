/*
 * Zing service worker.
 *
 * Two jobs:
 *   1. Keep the app shell openable with no network.
 *   2. Decrypt push notifications locally.
 *
 * The second is the interesting one. Our server cannot read messages, so it
 * cannot write "Kwame: on my way" into a push payload. Instead it sends a
 * data-only message carrying the same ciphertext that is in Firestore, and
 * this worker -- which can reach the private key in IndexedDB -- opens it and
 * builds the notification here on the device.
 *
 * Data-only matters: a payload with a `notification` block would be displayed
 * by the browser automatically, before this code ever runs, and it would show
 * ciphertext.
 */

const CACHE = 'zing-shell-v2';
const SHELL = ['/', '/chats', '/offline', '/zing-logo.png', '/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // Individually, so one 404 during development cannot fail the whole
      // install and leave the app with no worker at all.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

/**
 * Network-first for navigations, falling back to the cached shell.
 *
 * Deliberately not caching Firestore or Google APIs: Firestore has its own
 * offline persistence and second-guessing it here would serve stale data.
 */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || request.mode !== 'navigate') return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        void caches.open(CACHE).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(async () => (await caches.match(request)) ?? (await caches.match('/chats')) ?? Response.error()),
  );
});

/* ---------- crypto ---------- */

let sodiumReady = null;

function loadSodium() {
  if (!sodiumReady) {
    sodiumReady = (async () => {
      // The standard build, not sumo: this worker only opens sealed boxes and
      // secretboxes. It never derives a key from a passphrase, so it does not
      // need Argon2 and should not pay for it on every push.
      self.importScripts('/vendor/libsodium.js', '/vendor/libsodium-wrappers.js');
      await self.sodium.ready;
      return self.sodium;
    })();
  }
  return sodiumReady;
}

/** Read one record from the same IndexedDB the app writes to. */
function readRecord(store, key) {
  return new Promise((resolve) => {
    const open = indexedDB.open('zing');

    open.onerror = () => resolve(null);
    open.onsuccess = () => {
      const database = open.result;
      if (!database.objectStoreNames.contains(store)) {
        resolve(null);
        return;
      }
      const request = database.transaction(store, 'readonly').objectStore(store).get(key);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => resolve(null);
    };
  });
}

/**
 * Returns the plaintext, or null if this device cannot open it -- in which
 * case the caller falls back to a contentless notification rather than
 * showing nothing at all.
 */
async function decryptPreview(chatId, ciphertext, nonce) {
  try {
    const [sodium, privateKey, sealed] = await Promise.all([
      loadSodium(),
      readRecord('identity', 'privateKey'),
      readRecord('chatKeys', chatId),
    ]);

    if (!privateKey || !sealed) return null;

    const publicKey = sodium.crypto_scalarmult_base(privateKey);
    const conversationKey = sodium.crypto_box_seal_open(
      sodium.from_base64(sealed, sodium.base64_variants.ORIGINAL),
      publicKey,
      privateKey,
    );

    return sodium.to_string(
      sodium.crypto_secretbox_open_easy(
        sodium.from_base64(ciphertext, sodium.base64_variants.ORIGINAL),
        sodium.from_base64(nonce, sodium.base64_variants.ORIGINAL),
        conversationKey,
      ),
    );
  } catch {
    return null;
  }
}

self.addEventListener('push', (event) => {
  if (!event.data) return;

  event.waitUntil(
    (async () => {
      let payload;
      try {
        payload = event.data.json();
      } catch {
        return;
      }

      // FCM nests data-only payloads under `data`.
      const message = payload.data ?? payload;
      const { chatId, senderName, ciphertext, nonce } = message;
      if (!chatId) return;

      // Say nothing only when this very conversation is on screen -- the
      // message is visibly arriving there. Another chat open, the chat list,
      // or the app in the background all still get the buzz, like WhatsApp.
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const watching = clients.some(
        (client) =>
          client.visibilityState === 'visible' &&
          new URL(client.url).pathname === `/chats/${chatId}`,
      );
      if (watching) return;

      // Null when this device cannot open it, or when the message was too long
      // to fit in a push and was sent without its ciphertext.
      const text = ciphertext && nonce ? await decryptPreview(chatId, ciphertext, nonce) : null;
      const line = text ?? 'New message';

      // One notification per conversation, growing as messages arrive:
      // "Kwame · 3 messages" with the latest few lines underneath.
      const [previous] = await self.registration.getNotifications({ tag: chatId });
      const count = (previous?.data?.count ?? 0) + 1;
      const lines = [...(previous?.data?.lines ?? []), line].slice(-5);
      const name = senderName || 'Zing';

      await self.registration.showNotification(count > 1 ? `${name} · ${count} messages` : name, {
        body: lines.join('\n'),
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: chatId,
        renotify: true,       // buzz again for each new message, not just the first
        timestamp: Date.now(),
        data: { chatId, count, lines },
      });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = `/chats/${event.notification.data?.chatId ?? ''}`;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          void client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
