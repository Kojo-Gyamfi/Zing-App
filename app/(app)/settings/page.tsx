'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from '@/lib/store/session';
import { getPhone, setPhone as savePhone, updateProfile } from '@/lib/db/users';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';

export default function SettingsPage() {
  const { profile, signOut, refreshProfile } = useSession();

  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [about, setAbout] = useState(profile?.about ?? '');
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);

  // The number lives in its own doc, not the public profile.
  const uid = profile?.uid;
  useEffect(() => {
    if (!uid) return;
    void getPhone(uid, true).then((number) => setPhone(number ?? ''));
  }, [uid]);

  async function save() {
    if (!profile) return;

    setSaving(true);
    setPhoneError(null);
    await updateProfile(profile.uid, {
      displayName: displayName.trim() || profile.displayName,
      about: about.trim(),
    });

    try {
      await savePhone(profile.uid, phone);
    } catch (cause) {
      setPhoneError(
        (cause as Error).message === 'PHONE_TAKEN'
          ? 'That number is already linked to another account.'
          : 'Could not save your phone number.',
      );
      setSaving(false);
      return;
    }
    await refreshProfile();

    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  if (!profile) return null;

  return (
    <div className="h-dvh overflow-y-auto bg-void scroll-thin">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-surface px-2 pt-safe">
        <Link
          href="/chats"
          aria-label="Back"
          className="grid size-10 place-items-center rounded-full text-muted hover:bg-elevated"
        >
          <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
            <path d="M15 5 8 12l7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
        <h1 className="py-3 text-lg font-semibold">Settings</h1>
      </header>

      <div className="mx-auto max-w-lg space-y-8 p-4 pb-16">
        <div className="flex items-center gap-4">
          <Avatar name={profile.displayName} photoURL={profile.photoURL} size={72} />
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold">{profile.displayName}</p>
            <p className="truncate text-[14px] text-muted">@{profile.username}</p>
          </div>
        </div>

        <section className="space-y-4">
          <h2 className="text-[13px] font-semibold tracking-wide text-muted uppercase">Profile</h2>

          <Field
            label="Display name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            maxLength={40}
          />
          <Field
            label="About"
            value={about}
            onChange={(event) => setAbout(event.target.value)}
            maxLength={80}
          />
          <Field
            label="Phone number"
            hint="Optional. Lets friends find you, and people you chat with can see it."
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            inputMode="tel"
            error={phoneError}
          />

          <div className="flex items-center gap-3">
            <Button onClick={save} busy={saving}>
              Save changes
            </Button>
            {saved && <span className="text-[13px] text-zing">Saved</span>}
          </div>

          <p className="text-[12px] text-faint">
            Your @username cannot be changed — it is tied to your encryption identity.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-[13px] font-semibold tracking-wide text-muted uppercase">
            Encryption
          </h2>

          <div className="space-y-3 rounded-2xl border border-line bg-surface p-4">
            <p className="text-[12px] leading-relaxed text-faint">
              Messages are sealed on this device before they are sent. We store them as ciphertext
              and hold no key that opens them — which also means we cannot recover them for you.
            </p>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-[13px] font-semibold tracking-wide text-muted uppercase">Account</h2>

          {confirmingSignOut ? (
            <div className="space-y-3 rounded-2xl border border-danger/40 bg-surface p-4">
              <p className="text-[14px] leading-relaxed text-ink">
                Signing out erases the key stored on this device.
              </p>
              <p className="text-[13px] leading-relaxed text-muted">
                You will need your recovery passphrase to read your messages again. If you do not
                have it written down, do not sign out.
              </p>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setConfirmingSignOut(false)}>
                  Cancel
                </Button>
                <Button variant="danger" onClick={() => void signOut()}>
                  I have my passphrase — sign out
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="danger" onClick={() => setConfirmingSignOut(true)}>
              Sign out
            </Button>
          )}
        </section>
      </div>
    </div>
  );
}
