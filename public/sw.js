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

const CACHE = 'zing-shell-v4';

// libsodium, loaded here at the top level on purpose. Browsers only allow
// importScripts() while the worker is being installed; called later -- the
// first time a push arrives -- it throws, and every notification would fall
// back to "New message". Guarded so a missing file cannot stop the worker
// from installing at all.
//
// The standard build, not sumo: this worker only opens sealed boxes and
// secretboxes. It never derives a key from a passphrase, so it does not need
// Argon2 and should not pay for it on every start.
try {
  self.importScripts('/vendor/libsodium.js', '/vendor/libsodium-wrappers.js');
} catch {
  // Previews fall back to "New message".
}
const SHELL = ['/', '/chats', '/offline', '/zing-logo-dark.png', '/zing-mark.png', '/icon-192.png'];

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
        // Only good pages are kept: a 500 or a redirect cached here would
        // replace the working copy and be what offline users get.
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          event.waitUntil(
            caches
              .open(CACHE)
              .then((cache) => cache.put(request, copy))
              .catch(() => undefined),
          );
        }
        return response;
      })
      // Offline: this page as last seen, else the app shell (which can open
      // chats from Firestore's own cache), else the offline page.
      .catch(
        async () =>
          (await caches.match(request)) ??
          (await caches.match('/chats')) ??
          (await caches.match('/offline')) ??
          Response.error(),
      ),
  );
});

/* ---------- crypto ---------- */

let sodiumReady = null;

function loadSodium() {
  if (!sodiumReady) {
    sodiumReady = (async () => {
      if (!self.sodium) throw new Error('libsodium did not load');
      await self.sodium.ready;
      return self.sodium;
    })();
    // Not cached when it fails, so the next push tries again.
    sodiumReady.catch(() => {
      sodiumReady = null;
    });
  }
  return sodiumReady;
}

/** Read one record from the same IndexedDB the app writes to. */
function readRecord(store, key) {
  return new Promise((resolve) => {
    const open = indexedDB.open('zing');

    // No database yet: do not create an empty one here -- the app owns its
    // shape and version (lib/crypto/vault.ts).
    open.onupgradeneeded = () => open.transaction?.abort();
    open.onerror = () => resolve(null);
    open.onsuccess = () => {
      const database = open.result;
      // Closed after each read: a connection held open by this worker would
      // block the app from ever upgrading the database.
      const done = (value) => {
        database.close();
        resolve(value);
      };
      if (!database.objectStoreNames.contains(store)) {
        done(null);
        return;
      }
      try {
        const request = database.transaction(store, 'readonly').objectStore(store).get(key);
        request.onsuccess = () => done(request.result ?? null);
        request.onerror = () => done(null);
      } catch {
        done(null);
      }
    };
  });
}

/**
 * Write one record into the app's IndexedDB: the only write this worker
 * makes, a reply typed into a notification waiting for the app to send it.
 * False when the app has not created that store yet (an older version).
 */
function writeRecord(store, key, value) {
  return new Promise((resolve) => {
    const open = indexedDB.open('zing');
    open.onupgradeneeded = () => open.transaction?.abort();
    open.onerror = () => resolve(false);
    open.onsuccess = () => {
      const database = open.result;
      const done = (ok) => {
        database.close();
        resolve(ok);
      };
      if (!database.objectStoreNames.contains(store)) {
        done(false);
        return;
      }
      try {
        const tx = database.transaction(store, 'readwrite');
        tx.objectStore(store).put(value, key);
        tx.oncomplete = () => done(true);
        tx.onerror = () => done(false);
        tx.onabort = () => done(false);
      } catch {
        done(false);
      }
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
      const { chatId, senderName, senderUid, ciphertext, nonce, viewOnce } = message;
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
      // Previews switched off in Settings on this device: never decrypt them.
      const previews = (await readRecord('names', 'notificationPreviews')) !== false;
      const text =
        previews && ciphertext && nonce ? await decryptPreview(chatId, ciphertext, nonce) : null;
      // A view-once message arrives with no ciphertext at all; say what it is.
      const line = viewOnce === '1' ? 'View once message' : (text ?? 'New message');

      // One notification per conversation, growing as messages arrive:
      // "Kwame · 3 messages" with the latest few lines underneath.
      const [previous] = await self.registration.getNotifications({ tag: chatId });
      const count = (previous?.data?.count ?? 0) + 1;
      const lines = [...(previous?.data?.lines ?? []), line].slice(-5);
      // My nickname for them, if I gave one: kept on this device by the app,
      // because it is private and the push carries only their public name.
      const nicknames = senderUid ? await readRecord('names', 'nicknames') : null;
      const nickname = nicknames && typeof nicknames[senderUid] === 'string' ? nicknames[senderUid] : null;
      const name = nickname || senderName || 'Zing';

      await self.registration.showNotification(count > 1 ? `${name} · ${count} messages` : name, {
        body: lines.join('\n'),
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: chatId,
        renotify: true,       // buzz again for each new message, not just the first
        timestamp: Date.now(),
        data: { chatId, count, lines },
        // Reply right from the notification (Android and desktop Chrome). The
        // text goes to the app, which encrypts and sends it as always: this
        // worker never signs in or writes to the database. Browsers without
        // inline replies show a button that opens the chat instead.
        actions: [{ action: 'reply', type: 'text', title: 'Reply', placeholder: 'Reply…' }],
      });

      // The app icon's badge while the app is closed: messages waiting in
      // notifications. The chat list sets the exact count once it is open.
      if (self.navigator.setAppBadge) {
        const waiting = await self.registration.getNotifications();
        const total = waiting.reduce((sum, entry) => sum + (entry.data?.count ?? 0), 0);
        await self.navigator.setAppBadge(total).catch(() => undefined);
      }
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const chatId = event.notification.data?.chatId ?? '';
  const target = `/chats/${chatId}`;
  const reply = event.action === 'reply' && typeof event.reply === 'string' ? event.reply.trim() : '';

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

      // A reply typed into the notification: queued on this device for the
      // app, which sends it encrypted. An open tab is nudged to send it now,
      // in the background; with none open, the chat opens and sends it.
      if (reply && chatId) {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const queued = await writeRecord('outbox', id, { chatId, text: reply.slice(0, 4000), at: Date.now() });
        if (queued) {
          for (const client of clients) client.postMessage({ type: 'zing-outbox' });
          if (clients.length) return;
          return self.clients.openWindow(target);
        }
      }

      // "Reply" where the browser has no text box in notifications: the chat,
      // keyboard up.
      const destination = event.action === 'reply' ? `${target}?reply=1` : target;
      // navigate() only works on a window this worker controls; for any
      // other, it rejects and the tap would just focus the wrong page.
      for (const client of clients) {
        if (!('navigate' in client)) continue;
        const navigated = await client.navigate(destination).catch(() => null);
        if (navigated) return navigated.focus();
      }
      return self.clients.openWindow(destination);
    })(),
  );
});
