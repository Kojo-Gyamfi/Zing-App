import { openDB, type IDBPDatabase } from 'idb';
import { publicKeyFrom } from './identity';
import type { Identity } from './types';

/**
 * Device-local storage for the private key.
 *
 * IndexedDB rather than localStorage because it holds raw bytes without a
 * base64 round trip, and because service workers can read it -- that is what
 * lets push notifications decrypt their own previews.
 *
 * The honest caveat: the key sits here as plain bytes. Anything with script
 * access to this origin can read it. Defending further would mean a
 * non-extractable WebCrypto key, which libsodium's raw-byte API cannot use.
 *
 * On iOS this store is the reason installing matters: Safari evicts IndexedDB
 * after ~7 days of no visits, but exempts home-screen apps. Eviction is
 * survivable -- the passphrase backup restores it -- but it logs the user out
 * of their own history until they remember it.
 */

const DB_NAME = 'zing';
const DB_VERSION = 4;
const STORE = 'identity';
const RECORD = 'privateKey';
const KEYS_STORE = 'chatKeys';
// Nicknames, for the service worker's notification titles (see saveNicknames).
const NAMES_STORE = 'names';
// Replies typed into a notification, waiting for the app to send them. The
// service worker writes here; the app takes them out (takeOutbox).
const OUTBOX_STORE = 'outbox';
const NICKNAMES = 'nicknames';

let db: Promise<IDBPDatabase> | null = null;

function database() {
  if (!db) {
    db = openDB(DB_NAME, DB_VERSION, {
      upgrade(instance) {
        if (!instance.objectStoreNames.contains(STORE)) {
          instance.createObjectStore(STORE);
        }
        if (!instance.objectStoreNames.contains(KEYS_STORE)) {
          instance.createObjectStore(KEYS_STORE);
        }
        if (!instance.objectStoreNames.contains(NAMES_STORE)) {
          instance.createObjectStore(NAMES_STORE);
        }
        if (!instance.objectStoreNames.contains(OUTBOX_STORE)) {
          instance.createObjectStore(OUTBOX_STORE);
        }
      },
      // A newer version of the app opened in another tab wants to upgrade:
      // step aside, or its open waits on this tab forever and it never gets
      // past the splash. The next call here reopens at the new version.
      blocking() {
        void db?.then((instance) => instance.close());
        db = null;
      },
    }).catch((cause: unknown) => {
      // Not cached: a failed open (storage blocked, a private window) would
      // otherwise fail every later call for the rest of the session.
      db = null;
      throw cause;
    });
  }
  return db;
}

export async function saveIdentity(privateKey: Uint8Array): Promise<void> {
  const instance = await database();
  await instance.put(STORE, privateKey, RECORD);

  // Without this, Chrome and Firefox may evict the key under storage pressure
  // and bounce the user to /unlock. Best-effort: browsers may decline, and it
  // does not override Safari's 7-day rule for uninstalled sites.
  void navigator.storage?.persist?.().catch(() => false);
}

/** Null means this device has no key yet -- send the user to /unlock. */
export async function loadIdentity(): Promise<Identity | null> {
  const instance = await database();
  const privateKey: Uint8Array | undefined = await instance.get(STORE, RECORD);
  if (!privateKey) return null;

  return { privateKey, publicKey: await publicKeyFrom(privateKey) };
}

/**
 * Sign-out. Leaves the Firestore backup intact so the passphrase still works.
 * The cached sealed chat keys go too: inert without the private key, but they
 * belong to the account that just left this device.
 */
export async function clearIdentity(): Promise<void> {
  const instance = await database();
  await Promise.all([
    instance.delete(STORE, RECORD),
    instance.clear(KEYS_STORE),
    instance.clear(NAMES_STORE),
    instance.clear(OUTBOX_STORE),
  ]);
}

/**
 * My nicknames for people, by uid, for the service worker: a push names the
 * sender by their public name and uid only, because a nickname is private
 * and must not pass through FCM. The worker swaps it in from here.
 */
export async function saveNicknames(nicknames: Record<string, string>): Promise<void> {
  const instance = await database();
  await instance.put(NAMES_STORE, nicknames, NICKNAMES);
}

/** A reply from a notification: plaintext, on this device only, until sent. */
export type QueuedReply = { chatId: string; text: string; at: number };

/**
 * Every reply waiting to go, removed in the same transaction that reads it --
 * so two tabs taking at once can never both send the same one.
 */
export async function takeOutbox(): Promise<QueuedReply[]> {
  const instance = await database();
  const tx = instance.transaction(OUTBOX_STORE, 'readwrite');
  const items = (await tx.store.getAll()) as unknown[];
  await tx.store.clear();
  await tx.done;
  return items.filter(
    (item): item is QueuedReply =>
      !!item &&
      typeof (item as QueuedReply).chatId === 'string' &&
      typeof (item as QueuedReply).text === 'string',
  );
}

/**
 * Whether notifications on this device show what the message says, or only
 * "New message" -- for a lock screen other people see. The service worker
 * reads it; it is a setting of this device, not the account.
 */
const PREVIEWS = 'notificationPreviews';

export async function saveNotificationPreviews(on: boolean): Promise<void> {
  const instance = await database();
  await instance.put(NAMES_STORE, on, PREVIEWS);
}

export async function loadNotificationPreviews(): Promise<boolean> {
  const instance = await database();
  return (await instance.get(NAMES_STORE, PREVIEWS)) !== false;
}

/**
 * Sealed conversation keys, cached for the service worker.
 *
 * The worker has to decrypt notification previews while the app is closed, and
 * it cannot reach Firestore to fetch a key. Only the *sealed* blob is stored:
 * on its own it is inert, and opening it still requires the private key in
 * this same database. Nothing here is readable without that key.
 */
export async function saveSealedKey(chatId: string, sealed: string): Promise<void> {
  const instance = await database();
  await instance.put(KEYS_STORE, sealed, chatId);
}

export async function loadSealedKey(chatId: string): Promise<string | null> {
  const instance = await database();
  return (await instance.get(KEYS_STORE, chatId)) ?? null;
}
