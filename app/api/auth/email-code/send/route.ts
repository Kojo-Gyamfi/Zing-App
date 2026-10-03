import { NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase/admin';
import {
  CODE_TTL_MS,
  codeSecret,
  generateCode,
  hashCode,
  keyFor,
  looksLikeEmail,
  normalizeEmail,
} from '@/lib/auth/emailCode';
import { sendSignInCode } from '@/lib/email/send';

export const runtime = 'nodejs';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Email a 6-digit sign-in code.
 *
 * "I already have an account" checks first and refuses an address with no
 * Zing account, so a typo is caught before anyone waits for an email. That
 * does tell a caller whether an address is registered; the per-IP limit keeps
 * that from being done in bulk.
 */
export async function POST(request: Request) {
  let body: { email?: unknown; intent?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }
  if (typeof body.email !== 'string' || !looksLikeEmail(body.email)) {
    return NextResponse.json({ error: 'invalid-email' }, { status: 400 });
  }
  const email = normalizeEmail(body.email);
  const intent = body.intent === 'signin' ? 'signin' : 'signup';

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!(await allow(`ip:${ip}`, 20, HOUR_MS, 0))) {
    return NextResponse.json({ error: 'rate-limited' }, { status: 429 });
  }

  if (intent === 'signin' && !(await hasZingAccount(email))) {
    return NextResponse.json({ error: 'no-account' }, { status: 404 });
  }

  // One code a minute, five an hour, per address: enough for "resend", not
  // enough to flood someone's inbox.
  if (!(await allow(`email:${email}`, 5, HOUR_MS, 60_000))) {
    return NextResponse.json({ error: 'rate-limited' }, { status: 429 });
  }

  const code = generateCode();
  const emulated = process.env.NEXT_PUBLIC_USE_EMULATORS === '1';
  await adminDb()
    .doc(`emailCodes/${keyFor(email)}`)
    .set({
      hash: hashCode(codeSecret(), email, code),
      expiresAt: Date.now() + CODE_TTL_MS,
      attempts: 0,
      // End-to-end tests read the code back from the emulator; they have no
      // inbox. Never written against the real project.
      ...(emulated ? { devCode: code } : {}),
    });

  if (!emulated) {
    try {
      await sendSignInCode(email, code);
    } catch (cause) {
      console.error('Sending the sign-in code failed', cause);
      return NextResponse.json({ error: 'send-failed' }, { status: 502 });
    }
  }

  return NextResponse.json({ ok: true });
}

/** A Firebase account with a Zing profile behind it. */
async function hasZingAccount(email: string): Promise<boolean> {
  try {
    const user = await adminAuth().getUserByEmail(email);
    return (await adminDb().doc(`users/${user.uid}`).get()).exists;
  } catch {
    // auth/user-not-found
    return false;
  }
}

/**
 * Fixed-window limiter in Firestore, in the style of the push route's.
 * Fails closed: an unlimited path to sending email is worse than a retry.
 */
async function allow(
  key: string,
  limit: number,
  windowMs: number,
  minGapMs: number,
): Promise<boolean> {
  const ref = adminDb().doc(`emailCodeLimits/${keyFor(key)}`);
  try {
    return await adminDb().runTransaction(async (transaction) => {
      const now = Date.now();
      const current = (await transaction.get(ref)).data() as
        | { windowStart: number; count: number; last: number }
        | undefined;

      if (!current || now - current.windowStart >= windowMs) {
        transaction.set(ref, { windowStart: now, count: 1, last: now });
        return true;
      }
      if (current.count >= limit || now - current.last < minGapMs) return false;
      transaction.update(ref, { count: current.count + 1, last: now });
      return true;
    });
  } catch {
    return false;
  }
}
