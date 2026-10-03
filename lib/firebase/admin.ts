import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';

/**
 * Server-side Firebase, used for two things: sending push, and email sign-in
 * codes (app/api/auth/email-code).
 *
 * This is the only place Zing runs privileged code, and it deliberately never
 * touches message content -- it forwards ciphertext it cannot read to devices
 * that can, and its sign-in half only ever sees an email address.
 */

let app: App | null = null;

function admin(): App {
  if (app) return app;
  if (getApps().length) {
    app = getApps()[0];
    return app;
  }

  // End-to-end tests: the emulators need no credentials, and the SDK finds
  // them through FIREBASE_AUTH_EMULATOR_HOST / FIRESTORE_EMULATOR_HOST.
  if (process.env.NEXT_PUBLIC_USE_EMULATORS === '1') {
    app = initializeApp({ projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID });
    return app;
  }

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set');

  const credentials = JSON.parse(raw) as {
    project_id: string;
    client_email: string;
    private_key: string;
  };

  app = initializeApp({
    credential: cert({
      projectId: credentials.project_id,
      clientEmail: credentials.client_email,
      // Vercel stores the JSON with escaped newlines; the PEM parser needs
      // real ones.
      privateKey: credentials.private_key.replace(/\n/g, '\n'),
    }),
  });

  return app;
}

export const adminAuth = () => getAuth(admin());
export const adminDb = () => getFirestore(admin());
export const adminMessaging = () => getMessaging(admin());
