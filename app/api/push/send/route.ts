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
  const bearer = request.headers.get('authorization');
  const idToken = bearer?.startsWith('Bearer ') ? bearer.slice(7) : null;
  if (!idToken) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  let senderUid: string;
  try {
    senderUid = (await adminAuth().verifyIdToken(idToken)).uid;
  } catch {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const { chatId, ciphertext, nonce } = (await request.json()) as {
    chatId?: string;
    ciphertext?: string;
    nonce?: string;
  };

  if (!chatId || !ciphertext || !nonce) {
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }

  const chat = await adminDb().doc(`chats/${chatId}`).get();
  const members = (chat.data()?.members ?? []) as string[];

  // Membership is checked here as well as in the security rules: this route
  // holds admin credentials, so it cannot lean on them.
  if (!chat.exists || !members.includes(senderUid)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const [sender, ...recipients] = await Promise.all([
    adminDb().doc(`users/${senderUid}`).get(),
    ...members.filter((uid) => uid !== senderUid).map((uid) => adminDb().doc(`users/${uid}`).get()),
  ]);

  const senderName = (sender.data()?.displayName as string) ?? 'Someone';

  const targets = recipients.flatMap((doc) => {
    const tokens = (doc.data()?.pushTokens ?? []) as string[];
    return tokens.map((token) => ({ uid: doc.id, token }));
  });

  if (targets.length === 0) {
    return NextResponse.json({ sent: 0 });
  }

  const response = await adminMessaging().sendEachForMulticast({
    tokens: targets.map((target) => target.token),
    data: { chatId, senderName, ciphertext, nonce },
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
        .doc(`users/${uid}`)
        .update({ pushTokens: FieldValue.arrayRemove(...tokens) }),
    ),
  );

  return NextResponse.json({ sent: response.successCount });
}
