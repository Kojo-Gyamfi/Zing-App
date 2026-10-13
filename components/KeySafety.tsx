'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from '@/lib/store/session';
import { getRecoveryBackup } from '@/lib/db/users';

/**
 * Asks the browser, once the key is on this device, not to clear Zing's
 * storage when space runs low -- that storage holds the private key, and
 * losing it means typing the passphrase again. Chrome, Edge and Safari decide
 * quietly from how the site is used, so asking costs nothing and is repeated
 * each launch (installing Zing later can turn a "no" into a "yes"). Firefox
 * shows a permission prompt instead; there it's left to the button in
 * Settings → Storage, where the person knows why it's asked.
 */
export function KeepStorage() {
  useEffect(() => {
    if (/Firefox\//.test(navigator.userAgent)) return;
    const storage = navigator.storage;
    if (!storage?.persist || !storage.persisted) return;
    void storage
      .persisted()
      .then((kept) => (kept ? undefined : storage.persist()))
      .catch(() => undefined);
  }, []);
  return null;
}

const SNOOZED = 'zing.recovery.prompt.snoozed';
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

function snoozed(): boolean {
  try {
    return Date.now() - Number(localStorage.getItem(SNOOZED) ?? 0) < SNOOZE_MS;
  } catch {
    return false;
  }
}

// Once an account is known to have a recovery key it keeps one (making a new
// one replaces it), so that answer is kept for the session: one read, not one
// per visit to the chat list. "None" is checked again each time, so the card
// goes as soon as one is made in Settings.
const hasRecoveryKey = new Set<string>();

/**
 * Above the chat list, for accounts made before recovery keys existed: without
 * one, a forgotten passphrase means every message is gone for good. New
 * accounts make one during sign-up, so they never see this. "Later" brings it
 * back in a week.
 */
export function RecoveryPrompt() {
  const uid = useSession((state) => state.user?.uid);
  const [missing, setMissing] = useState(false);
  const [hidden, setHidden] = useState(snoozed);

  useEffect(() => {
    if (!uid || hidden || hasRecoveryKey.has(uid)) return;
    let live = true;
    void getRecoveryBackup(uid)
      .then((backup) => {
        if (backup) hasRecoveryKey.add(uid);
        if (live) setMissing(!backup);
      })
      // Offline or refused: say nothing rather than nag on a guess.
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [uid, hidden]);

  if (!missing || hidden) return null;

  function later() {
    try {
      localStorage.setItem(SNOOZED, String(Date.now()));
    } catch {
      // No storage: it just comes back next visit.
    }
    setHidden(true);
  }

  return (
    <div className="mx-4 mb-3 rounded-2xl border border-line bg-surface p-4">
      <p className="text-[14px] font-medium text-ink">Make a recovery key</p>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">
        If you ever forget your passphrase, a recovery key is the only other way back to your messages.
        Nobody at Zing can reset it for you.
      </p>
      <div className="mt-3 flex gap-2">
        <Link
          href="/settings#security"
          className="grid h-10 place-items-center rounded-full bg-zing px-4 text-[14px] font-semibold text-on-zing hover:bg-zing-dim"
        >
          Make one
        </Link>
        <button onClick={later} className="h-10 px-3 text-[14px] text-muted">
          Later
        </button>
      </div>
    </div>
  );
}
