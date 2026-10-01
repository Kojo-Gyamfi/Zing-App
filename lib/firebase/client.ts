import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import { getAuth, connectAuthEmulator, GoogleAuthProvider, type Auth } from 'firebase/auth';
import {
  initializeFirestore,
  connectFirestoreEmulator,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';
import { getDatabase, connectDatabaseEmulator, type Database } from 'firebase/database';

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

/**
 * Local Firebase Emulator Suite instead of the real project. Set only by the
 * end-to-end tests (see playwright.config.ts) -- never in .env.local.
 */
const USE_EMULATORS = process.env.NEXT_PUBLIC_USE_EMULATORS === '1';

const RECAPTCHA_SITE_KEY = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;

function app(): FirebaseApp {
  if (getApps().length) return getApp();

  const instance = initializeApp(config);

  // App Check: Firestore, RTDB and Auth only answer requests that carry a
  // token proving they came from this app on a real browser, so a script with
  // the (public) config above cannot use the project. Must run before any
  // other Firebase service is touched. Enforcement is switched on per service
  // in the Firebase Console.
  if (typeof window !== 'undefined' && RECAPTCHA_SITE_KEY && !USE_EMULATORS) {
    if (process.env.NODE_ENV === 'development') {
      // Prints a debug token to the console on first run; register it under
      // App Check -> Apps -> Manage debug tokens to use localhost/ngrok.
      (self as typeof self & { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    }
    initializeAppCheck(instance, {
      provider: new ReCaptchaV3Provider(RECAPTCHA_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });
  }

  return instance;
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
    if (USE_EMULATORS) connectFirestoreEmulator(firestore, '127.0.0.1', 8080);
  }
  return firestore;
}

let authInstance: Auth | null = null;

export function auth(): Auth {
  if (!authInstance) {
    authInstance = getAuth(app());
    if (USE_EMULATORS) {
      connectAuthEmulator(authInstance, 'http://127.0.0.1:9099', { disableWarnings: true });
    }
  }
  return authInstance;
}

let database: Database | null = null;

/** Typing and presence only -- Firestore has no onDisconnect equivalent. */
export function rtdb(): Database {
  if (!database) {
    database = getDatabase(app());
    if (USE_EMULATORS) connectDatabaseEmulator(database, '127.0.0.1', 9000);
  }
  return database;
}

export const googleProvider = new GoogleAuthProvider();
// Always show Google's account chooser. Without it, signing back in after a
// sign-out silently reuses the last Google account, with no way to pick
// another one.
googleProvider.setCustomParameters({ prompt: 'select_account' });
