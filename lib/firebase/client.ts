import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';
import { getDatabase, type Database } from 'firebase/database';

/**
 * Firebase, initialised once per browser.
 *
 * Everything here runs client-side: Zing's messaging path is the browser
 * talking straight to Firestore over its live listener channel. Vercel is
 * serverless and never sits in the middle of a message.
 */

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
};

function app(): FirebaseApp {
  return getApps().length ? getApp() : initializeApp(config);
}

let firestore: Firestore | null = null;

/**
 * Persistent cache is what makes Zing usable on a bad connection: reads come
 * off disk, writes queue while offline and flush on reconnect, and re-opening
 * a chat you have already read costs nothing.
 */
export function db(): Firestore {
  if (!firestore) {
    firestore = initializeFirestore(app(), {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  }
  return firestore;
}

export function auth(): Auth {
  return getAuth(app());
}

/** Typing and presence only -- Firestore has no onDisconnect equivalent. */
export function rtdb(): Database {
  return getDatabase(app());
}

export const googleProvider = new GoogleAuthProvider();
