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
const DB_VERSION = 2;
const STORE = 'identity';
const RECORD = 'privateKey';
const KEYS_STORE = 'chatKeys';

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
      },
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
  await Promise.all([instance.delete(STORE, RECORD), instance.clear(KEYS_STORE)]);
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
