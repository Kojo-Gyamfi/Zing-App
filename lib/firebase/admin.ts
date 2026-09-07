import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';

/**
 * Server-side Firebase, used for exactly one thing: sending push.
 *
 * This is the only place Zing runs privileged code, and it deliberately never
 * touches message content -- it forwards ciphertext it cannot read to devices
 * that can.
 */

let app: App | null = null;

function admin(): App {
  if (app) return app;
  if (getApps().length) {
    app = getApps()[0];
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
