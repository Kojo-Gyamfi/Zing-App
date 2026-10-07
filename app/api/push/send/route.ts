import { NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminAuth, adminDb, adminMessaging } from '@/lib/firebase/admin';

export const runtime = 'nodejs';

/**
 * Fan a new message out as a push notification.
 *
 * The payload is deliberately data-only and carries the same ciphertext that
 * is already in Firestore. A `notification` block would be rendered by the
 * browser before our service worker runs, which would put unreadable
 * ciphertext on someone's lock screen; instead the worker decrypts it on the
 * device and builds the notification there.
 *
 * This route can read none of what it forwards.
 */
export async function POST(request: Request) {
  // End-to-end tests run against the emulators, which have no FCM. Never let
  // a test reach the real project's push service.
  if (process.env.NEXT_PUBLIC_USE_EMULATORS === '1') {
    return NextResponse.json({ sent: 0 });
  }

  const bearer = request.headers.get('authorization');
  const idToken = bearer?.startsWith('Bearer ') ? bearer.slice(7) : null;
  if (!idToken) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  // Set up the admin SDK on its own first: a missing or broken
  // FIREBASE_SERVICE_ACCOUNT is our misconfiguration, and must show up in the
  // logs as one -- not pass for a bad token, which the app quietly ignores.
  let auth: ReturnType<typeof adminAuth>;
  try {
    auth = adminAuth();
  } catch (cause) {
    console.error('Push: the Firebase Admin SDK could not start', cause);
    return NextResponse.json({ error: 'server misconfigured' }, { status: 500 });
  }

  let senderUid: string;
  try {
    senderUid = (await auth.verifyIdToken(idToken)).uid;
  } catch {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  let body: { chatId?: unknown; ciphertext?: unknown; nonce?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }
  const { chatId, ciphertext, nonce } = body;

  if (typeof chatId !== 'string' || typeof ciphertext !== 'string' || typeof nonce !== 'string') {
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }
  // Two uids joined by "_". Anything else -- a "/" especially -- would let the
  // id name some other document path.
  if (!/^[A-Za-z0-9]{1,128}_[A-Za-z0-9]{1,128}$/.test(chatId)) {
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }

  if (!(await withinRateLimit(senderUid))) {
    return NextResponse.json({ error: 'rate limited' }, { status: 429 });
  }

  const chat = await adminDb().doc(`chats/${chatId}`).get();
  const members = (chat.data()?.members ?? []) as string[];

  // Membership is checked here as well as in the security rules: this route
  // holds admin credentials, so it cannot lean on them.
  if (!chat.exists || !members.includes(senderUid)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // The rules refuse messages in a blocked chat, but this route is called
  // separately, so a hand-rolled client could still try to buzz the blocker.
  if (Object.keys(chat.data()?.blocked ?? {}).length > 0) {
    return NextResponse.json({ sent: 0 });
  }

  const [sender, ...recipients] = await Promise.all([
    adminDb().doc(`users/${senderUid}`).get(),
    ...members
      .filter((uid) => uid !== senderUid)
      .map((uid) => adminDb().doc(`users/${uid}/private/account`).get()),
  ]);

  const senderName = (sender.data()?.displayName as string) ?? 'Someone';

  const targets = recipients.flatMap((doc) => {
    // Muted: no push at all. Leaving it to the service worker to stay quiet
    // is not an option -- browsers expect every push to show something, and
    // revoke the subscription of a worker that keeps showing nothing.
    if (((doc.data()?.muted ?? []) as string[]).includes(chatId)) return [];
    const tokens = (doc.data()?.pushTokens ?? []) as string[];
    // doc is users/{uid}/private/account, so the uid is two levels up.
    return tokens.map((token) => ({ uid: doc.ref.parent.parent!.id, token }));
  });

  if (targets.length === 0) {
    return NextResponse.json({ sent: 0 });
  }

  // FCM rejects data payloads over 4 KB. A long message goes out without its
  // ciphertext, and the service worker shows "New message" instead of a preview.
  const fits = chatId.length + senderName.length + ciphertext.length + nonce.length < 3500;
  const data: Record<string, string> = fits
    ? { chatId, senderName, ciphertext, nonce }
    : { chatId, senderName };

  const response = await adminMessaging().sendEachForMulticast({
    tokens: targets.map((target) => target.token),
    data,
    webpush: { headers: { Urgency: 'high', TTL: '600' } },
  });

  // Tokens die when a browser is uninstalled or storage is cleared. Left in
  // place they slow every later send and never recover, so prune as we go.
  const stale = new Map<string, string[]>();
  response.responses.forEach((result, index) => {
    const code = result.error?.code ?? '';
    if (
      code.includes('registration-token-not-registered') ||
      code.includes('invalid-argument') ||
      code.includes('invalid-registration-token')
    ) {
      const { uid, token } = targets[index];
      stale.set(uid, [...(stale.get(uid) ?? []), token]);
    }
  });

  await Promise.all(
    [...stale].map(([uid, tokens]) =>
      adminDb()
        .doc(`users/${uid}/private/account`)
        .update({ pushTokens: FieldValue.arrayRemove(...tokens) }),
    ),
  );

  return NextResponse.json({ sent: response.successCount });
}

/** Pushes one account may trigger per minute: well above real chatting. */
const PUSH_LIMIT = 30;
const WINDOW_MS = 60_000;

/**
 * Per-sender rate limit, so one account cannot buzz someone's phone in a
 * loop. Kept in Firestore because serverless instances share no memory. The
 * pushLimits collection has no client rule, so only this route (admin
 * credentials) can read or write it.
 */
async function withinRateLimit(uid: string): Promise<boolean> {
  const ref = adminDb().doc(`pushLimits/${uid}`);
  try {
    return await adminDb().runTransaction(async (transaction) => {
      const now = Date.now();
      const current = (await transaction.get(ref)).data() as
        | { windowStart: number; count: number }
        | undefined;

      if (!current || now - current.windowStart >= WINDOW_MS) {
        transaction.set(ref, { windowStart: now, count: 1 });
        return true;
      }
      if (current.count >= PUSH_LIMIT) return false;
      transaction.update(ref, { count: current.count + 1 });
      return true;
    });
  } catch {
    // The limiter failing must not silence real messages.
    return true;
  }
}
