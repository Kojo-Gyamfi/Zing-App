import { NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase/admin';
import {
  MAX_ATTEMPTS,
  codeMatches,
  codeSecret,
  isCodeShaped,
  keyFor,
  looksLikeEmail,
  normalizeEmail,
} from '@/lib/auth/emailCode';

export const runtime = 'nodejs';

type Outcome = 'ok' | 'invalid-code' | 'expired' | 'too-many-attempts';

/**
 * Check a sign-in code and, if it is right, return a Firebase custom token
 * for the account that owns the address -- created on first use, and the
 * same account a Google sign-in with that address would reach.
 */
export async function POST(request: Request) {
  let body: { email?: unknown; code?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }
  if (typeof body.email !== 'string' || !looksLikeEmail(body.email)) {
    return NextResponse.json({ error: 'invalid-email' }, { status: 400 });
  }
  const email = normalizeEmail(body.email);
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (!isCodeShaped(code)) {
    return NextResponse.json({ error: 'invalid-code' }, { status: 400 });
  }

  // Looked up before the code is spent: a passing hiccup here must not cost
  // the person their code. Only "no such user" means "create one".
  let existingUid: string | null;
  try {
    existingUid = (await adminAuth().getUserByEmail(email)).uid;
  } catch (cause) {
    if ((cause as { code?: string }).code !== 'auth/user-not-found') {
      return NextResponse.json({ error: 'unavailable' }, { status: 503 });
    }
    existingUid = null;
  }

  const ref = adminDb().doc(`emailCodes/${keyFor(email)}`);
  const secret = codeSecret();
  const outcome = await adminDb().runTransaction<Outcome>(async (transaction) => {
    const stored = (await transaction.get(ref)).data() as
      | { hash: string; expiresAt: number; attempts: number }
      | undefined;
    if (!stored || Date.now() > stored.expiresAt) return 'expired';
    if (stored.attempts >= MAX_ATTEMPTS) return 'too-many-attempts';
    if (!codeMatches(secret, email, code, stored.hash)) {
      transaction.update(ref, { attempts: stored.attempts + 1 });
      return 'invalid-code';
    }
    // One use only.
    transaction.delete(ref);
    return 'ok';
  });

  if (outcome !== 'ok') {
    return NextResponse.json({ error: outcome }, { status: outcome === 'invalid-code' ? 401 : 410 });
  }

  let uid = existingUid;
  if (!uid) {
    try {
      uid = (await adminAuth().createUser({ email, emailVerified: true })).uid;
    } catch (cause) {
      // Created in the moment since the lookup (a second tab, a Google
      // sign-in): that is the account to use.
      if ((cause as { code?: string }).code !== 'auth/email-already-exists') throw cause;
      uid = (await adminAuth().getUserByEmail(email)).uid;
    }
  }
  return NextResponse.json({ token: await adminAuth().createCustomToken(uid) });
}
