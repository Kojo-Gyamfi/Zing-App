'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from '@/lib/store/session';
import {
  getPhone,
  getRecoveryBackup,
  setPhone as savePhone,
  setRecoveryBackup,
  updateKeyBackup,
  updateProfile,
} from '@/lib/db/users';
import { formatPhone, limitPhoneInput } from '@/lib/phone';
import { enablePush, isIOS, pushState, type PushState } from '@/lib/push';
import { wrapPrivateKey } from '@/lib/crypto/backup';
import { deleteAccount, NEEDS_FRESH_SIGNIN } from '@/lib/db/account';
import { emailCodeError, requestCode, verifyCode } from '@/lib/auth/emailCodeClient';
import { auth } from '@/lib/firebase/client';
import { generateRecoveryKey, wrapWithRecoveryKey } from '@/lib/crypto/recovery';
import { useMyPhoto } from '@/lib/store/account';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { RecoveryKeyDisplay } from '@/components/RecoveryKeyDisplay';
import { ShareProfileCard } from '@/components/settings/ShareProfileCard';
import { PrivacySettings } from '@/components/settings/PrivacySettings';

const MIN_PASSPHRASE = 10;

export default function SettingsPage() {
  const { user, profile, identity, signOut, refreshProfile } = useSession();
  const myPhoto = useMyPhoto(profile?.photoURL);

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Set when an email account is asked to confirm with a fresh code.
  const [deleteCodeSentTo, setDeleteCodeSentTo] = useState<string | null>(null);
  const [deleteCode, setDeleteCode] = useState('');

  async function removeAccount() {
    if (!user || !profile) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      if (deleteCodeSentTo) {
        // Signing in again with the code is what makes the sign-in recent.
        try {
          await verifyCode(deleteCodeSentTo, deleteCode);
        } catch (cause) {
          setDeleteError(emailCodeError(cause));
          setDeleting(false);
          return;
        }
      }
      // After a fresh sign-in, the current user object is the one with the
      // new credentials.
      await deleteAccount(auth().currentUser ?? user, profile.username);
      // Forget the key on this device; the auth account is already gone.
      await signOut();
    } catch (cause) {
      const code = (cause as { code?: string }).code ?? '';
      if (code === NEEDS_FRESH_SIGNIN && user.email) {
        // Nothing has been deleted yet.
        try {
          await requestCode(user.email, 'signin');
          setDeleteCodeSentTo(user.email);
          setDeleteCode('');
          setDeleteError(null);
        } catch (sendCause) {
          setDeleteError(emailCodeError(sendCause));
        }
        setDeleting(false);
        return;
      }
      setDeleteError(
        code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request'
          ? 'Confirm with Google to delete your account.'
          : code === 'auth/user-mismatch'
            ? 'Pick the Google account you use for Zing.'
            : 'Could not delete your account. Check your connection and try again.',
      );
      setDeleting(false);
    }
  }

  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [about, setAbout] = useState(profile?.about ?? '');
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);

  const [changingPassphrase, setChangingPassphrase] = useState(false);
  const [newPassphrase, setNewPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [passphraseError, setPassphraseError] = useState<string | null>(null);
  const [passphraseBusy, setPassphraseBusy] = useState(false);
  const [passphraseSaved, setPassphraseSaved] = useState(false);

  // undefined while loading, null when this account has never made one.
  const [recoveryCreated, setRecoveryCreated] = useState<Date | null | undefined>(undefined);
  const [confirmingNewKey, setConfirmingNewKey] = useState(false);
  const [newRecoveryKey, setNewRecoveryKey] = useState<string | null>(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);

  const [push, setPush] = useState<PushState | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void pushState().then((next) => {
      if (live) setPush(next);
    });
    return () => {
      live = false;
    };
  }, []);

  async function turnOnPush() {
    if (!profile) return;
    setPushBusy(true);
    const outcome = await enablePush(profile.uid);
    setPushBusy(false);
    setPush(outcome === 'granted' ? 'granted' : outcome === 'denied' ? 'denied' : 'unsupported');
  }

  // The number lives in its own doc, not the public profile.
  const uid = profile?.uid;
  useEffect(() => {
    if (!uid) return;
    void getPhone(uid).then((number) => setPhone(number ? formatPhone(number) : ''));
    void getRecoveryBackup(uid)
      .then((doc) => setRecoveryCreated(doc ? (doc.createdAt?.toDate() ?? new Date()) : null))
      .catch(() => setRecoveryCreated(null));
  }, [uid]);

  /**
   * No old passphrase needed: this device already holds the private key, which
   * is what the passphrase protects. Someone who forgot theirs but still has an
   * unlocked phone fixes it here.
   */
  async function changePassphrase() {
    if (!profile || !identity) return;
    setPassphraseError(null);

    if (newPassphrase.length < MIN_PASSPHRASE) {
      setPassphraseError(`At least ${MIN_PASSPHRASE} characters.`);
      return;
    }
    if (newPassphrase !== confirmPassphrase) {
      setPassphraseError('Those two do not match.');
      return;
    }

    setPassphraseBusy(true);
    try {
      await updateKeyBackup(profile.uid, await wrapPrivateKey(identity.privateKey, newPassphrase));
      await refreshProfile();
      setChangingPassphrase(false);
      setNewPassphrase('');
      setConfirmPassphrase('');
      setPassphraseSaved(true);
      setTimeout(() => setPassphraseSaved(false), 3000);
    } catch {
      setPassphraseError('Could not save. Check your connection and try again.');
    } finally {
      setPassphraseBusy(false);
    }
  }

  /** Overwrites the old recovery doc, so the previous key stops working. */
  async function createRecoveryKey() {
    if (!profile || !identity) return;
    setRecoveryError(null);
    setRecoveryBusy(true);
    try {
      const recoveryKey = await generateRecoveryKey();
      await setRecoveryBackup(
        profile.uid,
        await wrapWithRecoveryKey(identity.privateKey, recoveryKey),
      );
      setNewRecoveryKey(recoveryKey);
      setRecoveryCreated(new Date());
      setConfirmingNewKey(false);
    } catch {
      setRecoveryError('Could not create a recovery key. Check your connection and try again.');
    } finally {
      setRecoveryBusy(false);
    }
  }

  async function save() {
    if (!profile) return;

    setSaving(true);
    setPhoneError(null);
    setSaveError(null);

    // Name and about first, on their own: a refused write must say so, not
    // leave "Save changes" spinning.
    try {
      await updateProfile(profile.uid, {
        displayName: displayName.trim() || profile.displayName,
        about: about.trim(),
      });
    } catch {
      setSaveError('Could not save your profile. Check your connection and try again.');
      setSaving(false);
      return;
    }

    try {
      await savePhone(profile.uid, phone);
    } catch (cause) {
      const code = (cause as Error).message;
      setPhoneError(
        code === 'PHONE_TAKEN'
          ? 'That number is already linked to another account.'
          : code === 'PHONE_INVALID'
            ? 'That doesn’t look like a valid phone number (up to 10 digits).'
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
          <Avatar name={profile.displayName} photoURL={myPhoto} size={72} />
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
            hint="Optional. Lets friends find you, and people you chat with can see it. Not verified."
            value={phone}
            onChange={(event) => setPhone(limitPhoneInput(event.target.value))}
            placeholder="024 123 4567"
            inputMode="tel"
            error={phoneError}
          />

          <div className="flex items-center gap-3">
            <Button onClick={save} busy={saving}>
              Save changes
            </Button>
            {saved && <span className="text-[13px] text-zing">Saved</span>}
          </div>
          {saveError && <p className="text-[12px] text-danger">{saveError}</p>}

          <p className="text-[12px] text-faint">
            Your @username cannot be changed — it is tied to your encryption identity.
          </p>
        </section>

        <ShareProfileCard profile={profile} />

        <PrivacySettings uid={profile.uid} photoURL={myPhoto} />

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
          <h2 className="text-[13px] font-semibold tracking-wide text-muted uppercase">
            Notifications
          </h2>

          <div className="space-y-3 rounded-2xl border border-line bg-surface p-4">
            <div>
              <p className="text-[14px] font-medium text-ink">
                Message notifications
                {push === 'granted' && <span className="ml-2 text-[13px] text-zing">On</span>}
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-faint">
                {push === null
                  ? 'Checking…'
                  : push === 'granted'
                    ? 'This device buzzes when a message arrives. The preview is decrypted here — the server only forwards ciphertext.'
                    : push === 'denied'
                      ? 'Blocked for Zing in this browser. Tap the icon beside the address bar (or open site settings), allow Notifications, then reload.'
                      : push === 'unsupported'
                        ? isIOS()
                          ? 'On iPhone, add Zing to your Home Screen first (Share → Add to Home Screen), then turn them on from the installed app.'
                          : 'This browser cannot show notifications.'
                        : 'Get a notification on this device when someone messages you.'}
              </p>
            </div>
            {push === 'default' && (
              <Button onClick={() => void turnOnPush()} busy={pushBusy}>
                Turn on notifications
              </Button>
            )}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-[13px] font-semibold tracking-wide text-muted uppercase">Security</h2>

          <div className="space-y-3 rounded-2xl border border-line bg-surface p-4">
            <div>
              <p className="text-[14px] font-medium text-ink">Passphrase</p>
              <p className="mt-1 text-[12px] leading-relaxed text-faint">
                Unlocks your messages on a new device. You don&apos;t need the old one to change
                it — this device already holds your key.
              </p>
            </div>

            {changingPassphrase ? (
              <div className="space-y-3">
                <Field
                  label="New passphrase"
                  type="password"
                  value={newPassphrase}
                  onChange={(event) => setNewPassphrase(event.target.value)}
                  hint="At least 10 characters. A few random words beats one clever word."
                  autoComplete="new-password"
                />
                <Field
                  label="Type it again"
                  type="password"
                  value={confirmPassphrase}
                  onChange={(event) => setConfirmPassphrase(event.target.value)}
                  error={passphraseError}
                  autoComplete="new-password"
                />
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setChangingPassphrase(false);
                      setPassphraseError(null);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={changePassphrase}
                    busy={passphraseBusy}
                    disabled={!newPassphrase || !confirmPassphrase}
                  >
                    Save passphrase
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <Button variant="ghost" onClick={() => setChangingPassphrase(true)}>
                  Change passphrase
                </Button>
                {passphraseSaved && <span className="text-[13px] text-zing">Passphrase changed</span>}
              </div>
            )}
          </div>

          <div className="space-y-3 rounded-2xl border border-line bg-surface p-4">
            <div>
              <p className="text-[14px] font-medium text-ink">Recovery key</p>
              <p className="mt-1 text-[12px] leading-relaxed text-faint">
                {recoveryCreated === undefined
                  ? 'Checking…'
                  : recoveryCreated === null
                    ? 'You have no recovery key. Without one, a forgotten passphrase means your messages are gone for good.'
                    : `Created ${recoveryCreated.toLocaleDateString()}. The only way back in if you forget your passphrase.`}
              </p>
            </div>

            {newRecoveryKey ? (
              <div className="space-y-3">
                <p className="text-[13px] leading-relaxed font-medium text-ink">
                  Save this now — we can&apos;t show it again. Any older recovery key no longer
                  works.
                </p>
                <RecoveryKeyDisplay recoveryKey={newRecoveryKey} username={profile.username} />
                <Button variant="ghost" onClick={() => setNewRecoveryKey(null)} className="w-full">
                  I&apos;ve saved it
                </Button>
              </div>
            ) : confirmingNewKey ? (
              <div className="space-y-3">
                <p className="text-[13px] leading-relaxed text-muted">
                  Your current recovery key will stop working the moment a new one is made.
                </p>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => setConfirmingNewKey(false)}>
                    Cancel
                  </Button>
                  <Button onClick={createRecoveryKey} busy={recoveryBusy}>
                    Replace it
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant={recoveryCreated === null ? 'primary' : 'ghost'}
                busy={recoveryBusy}
                disabled={recoveryCreated === undefined}
                onClick={() =>
                  recoveryCreated ? setConfirmingNewKey(true) : void createRecoveryKey()
                }
              >
                {recoveryCreated ? 'Create a new recovery key' : 'Create a recovery key'}
              </Button>
            )}
            {recoveryError && <p className="text-[12px] text-danger">{recoveryError}</p>}
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
                You will need your passphrase or recovery key to read your messages again. If you
                have neither written down, do not sign out.
              </p>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setConfirmingSignOut(false)}>
                  Cancel
                </Button>
                <Button variant="danger" onClick={() => void signOut()}>
                  I have them — sign out
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="danger" onClick={() => setConfirmingSignOut(true)}>
              Sign out
            </Button>
          )}

          {confirmingDelete ? (
            <div className="space-y-3 rounded-2xl border border-danger/40 bg-surface p-4">
              <p className="text-[14px] font-medium leading-relaxed text-ink">
                Delete your Zing account?
              </p>
              <p className="text-[13px] leading-relaxed text-muted">
                Your profile, @{profile.username}, phone number, key backups and settings are
                erased, and your handle becomes free for someone else. Messages you sent stay in
                the other person&apos;s chats. You cannot read any of your chats again — this
                cannot be undone.
              </p>
              <Field
                label={`Type ${profile.username} to confirm`}
                value={deleteConfirm}
                onChange={(event) => setDeleteConfirm(event.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                error={deleteCodeSentTo ? null : deleteError}
              />
              {deleteCodeSentTo && (
                <Field
                  label={`Code sent to ${deleteCodeSentTo}`}
                  hint="To confirm it's you, enter the 6-digit code we just emailed."
                  value={deleteCode}
                  onChange={(event) =>
                    setDeleteCode(event.target.value.replace(/\D/g, '').slice(0, 6))
                  }
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  error={deleteError}
                />
              )}
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setConfirmingDelete(false);
                    setDeleteConfirm('');
                    setDeleteError(null);
                    setDeleteCodeSentTo(null);
                    setDeleteCode('');
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  busy={deleting}
                  disabled={
                    deleteConfirm.trim().toLowerCase() !== profile.username ||
                    (deleteCodeSentTo !== null && deleteCode.length !== 6)
                  }
                  onClick={() => void removeAccount()}
                >
                  Delete forever
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="danger" onClick={() => setConfirmingDelete(true)}>
              Delete my account
            </Button>
          )}
        </section>
      </div>
    </div>
  );
}
