'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSession } from '@/lib/store/session';
import {
  getOwnPhone,
  getRecoveryBackup,
  setPhone as savePhone,
  setRecoveryBackup,
  updateKeyBackup,
  updateProfile,
} from '@/lib/db/users';
import { formatPhone, limitPhoneInput } from '@/lib/phone';
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
import { UsernameSetting } from '@/components/settings/UsernameSetting';
import { SettingsSection, SECTION_ICONS } from '@/components/settings/SettingsSection';
import {
  NotificationSettings,
  notificationSummary,
  useNotificationStatus,
} from '@/components/settings/NotificationSettings';
import { StorageSettings, storageSummary, useStorageEstimate } from '@/components/settings/StorageSettings';
import { AboutSettings, ChatsSettings, useDraftCount } from '@/components/settings/ChatsSettings';
import { WALLPAPER_NAMES } from '@/components/settings/WallpaperPicker';
import { QrScanner } from '@/components/QrScanner';
import { TypingSettings, typingSummary } from '@/components/settings/TypingSettings';
import { useAccount } from '@/lib/store/account';
import { useRouter } from 'next/navigation';
import { AppearanceSettings } from '@/components/settings/AppearanceSettings';

const MIN_PASSPHRASE = 10;

const SECTIONS = [
  'profile',
  'share',
  'appearance',
  'privacy',
  'notifications',
  'chats',
  'typing',
  'security',
  'storage',
  'account',
  'about',
] as const;
type SectionId = (typeof SECTIONS)[number];

/** Which sections were left open on this device, remembered between visits. */
const OPEN_KEY = 'zing.settings.open';

function storedOpenSections(): Set<SectionId> {
  try {
    const saved = JSON.parse(localStorage.getItem(OPEN_KEY) ?? '[]') as unknown;
    return new Set(
      Array.isArray(saved) ? saved.filter((id): id is SectionId => SECTIONS.includes(id)) : [],
    );
  } catch {
    return new Set();
  }
}

export default function SettingsPage() {
  const { user, profile, identity, signOut, refreshProfile } = useSession();
  const myPhoto = useMyPhoto(profile?.photoURL);
  const router = useRouter();
  const appearance = useAccount((state) => state.settings.appearance);
  const privacy = useAccount((state) => state.settings.privacy);
  const blocked = useAccount((state) => state.settings.blocked);
  const proofreadSettings = useAccount((state) => state.settings.proofread);
  const notifications = useNotificationStatus(profile?.uid ?? '');
  const storage = useStorageEstimate();
  const draftCount = useDraftCount(profile?.uid ?? '');
  const [scanning, setScanning] = useState(false);

  // Collapsed by default, as left last time otherwise. A link to
  // /settings#notifications opens that one and brings it into view.
  const [openSections, setOpenSections] = useState<Set<SectionId>>(() => {
    if (typeof window === 'undefined') return new Set();
    const open = storedOpenSections();
    const target = window.location.hash.slice(1) as SectionId;
    if (SECTIONS.includes(target)) open.add(target);
    return open;
  });
  useEffect(() => {
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify([...openSections]));
    } catch {
      // Not remembered; it still works for this visit.
    }
  }, [openSections]);
  useEffect(() => {
    const target = window.location.hash.slice(1);
    if (!SECTIONS.includes(target as SectionId)) return;
    const frame = requestAnimationFrame(() =>
      document.getElementById(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    );
    return () => cancelAnimationFrame(frame);
  }, [profile]);

  const toggleSection = (id: SectionId) =>
    setOpenSections((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const openAll = () => setOpenSections(new Set(SECTIONS));
  const closeAll = () => setOpenSections(new Set());
  /** Open one section and bring it into view, as the shortcut buttons do. */
  const openOnly = (id: SectionId) => {
    setOpenSections((current) => new Set(current).add(id));
    requestAnimationFrame(() =>
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    );
  };

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Set when an email account is asked to confirm with a fresh code.
  const [deleteCodeSentTo, setDeleteCodeSentTo] = useState<string | null>(null);
  const [deleteCode, setDeleteCode] = useState('');

  async function removeAccount() {
    if (!user || !profile) return;
    // Deleting is several writes; offline, they would queue and leave the
    // account half-deleted whenever the connection came back.
    if (!navigator.onLine) {
      setDeleteError('You’re offline. Connect, then delete your account.');
      return;
    }
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
        // Used now: a retry must not send it again (it would be "expired").
        setDeleteCodeSentTo(null);
        setDeleteCode('');
      }
      // After a fresh sign-in, the current user object is the one with the
      // new credentials.
      await deleteAccount(auth().currentUser ?? user, profile.username);
      // Forget the key on this device; the auth account is already gone.
      await signOut();
    } catch (cause) {
      const code = (cause as { code?: string }).code ?? '';
      if (code === NEEDS_FRESH_SIGNIN && user.email) {
        // Usually nothing has been deleted yet. But a retry after a deletion
        // that failed at its last step has no profile left, and a "signin"
        // code is only sent to an address with one -- "signup" sends to any.
        try {
          await requestCode(user.email, 'signup');
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
          : code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment'
            ? 'This browser blocked the Google sign-in window. Allow pop-ups for Zing, or open Zing in your browser rather than the installed app, and try again.'
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
  // The number as loaded: undefined until then (or if it could not be read),
  // so Save never mistakes "not loaded" for "removed" and deletes it.
  const [loadedPhone, setLoadedPhone] = useState<string | undefined>(undefined);
  const phoneEdited = useRef(false);
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

  // The number lives in its own doc, not the public profile.
  const uid = profile?.uid;
  useEffect(() => {
    if (!uid) return;
    void getOwnPhone(uid)
      .then((number) => {
        const shown = number ? formatPhone(number) : '';
        setLoadedPhone(shown);
        // A read that lands late must not overwrite what is being typed.
        if (!phoneEdited.current) setPhone(shown);
      })
      .catch(() => undefined);
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

    // Offline, the write would queue and spin here until the connection came
    // back -- maybe after the person had given up and forgotten what they typed.
    if (!navigator.onLine) {
      setPassphraseError('You’re offline. Connect, then change it.');
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
    // A queued write would replace the old key whenever the connection came
    // back, with a new one nobody may still have on screen.
    if (!navigator.onLine) {
      setRecoveryError('You’re offline. Connect, then create the key.');
      return;
    }
    setRecoveryBusy(true);
    let recoveryKey: string | null = null;
    try {
      recoveryKey = await generateRecoveryKey();
      const backup = await wrapWithRecoveryKey(identity.privateKey, recoveryKey);
      // Shown before the write is confirmed: if the connection drops now, the
      // write still lands later, and the key it makes valid is on screen.
      setNewRecoveryKey(recoveryKey);
      setConfirmingNewKey(false);
      await setRecoveryBackup(profile.uid, backup);
      setRecoveryCreated(new Date());
    } catch {
      // Refused, so the old key still stands and this one means nothing.
      setNewRecoveryKey((shown) => (shown === recoveryKey ? null : shown));
      setRecoveryError('Could not create a recovery key. Check your connection and try again.');
    } finally {
      setRecoveryBusy(false);
    }
  }

  async function save() {
    if (!profile) return;
    // Offline, the write would queue and "Save changes" spin until reconnect.
    if (!navigator.onLine) {
      setSaveError('You’re offline. Connect, then save.');
      return;
    }

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

    // Only a change the person made: before the number has loaded, an empty
    // field means "not shown yet", not "remove it".
    const phoneChanged = loadedPhone === undefined ? phone.trim() !== '' : phone !== loadedPhone;
    try {
      if (phoneChanged) {
        await savePhone(profile.uid, phone);
        setLoadedPhone(phone);
      }
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

  const theme = { system: 'System', light: 'Light', dark: 'Dark' }[appearance.theme];
  const summaries: Record<SectionId, string> = {
    profile: `@${profile.username} · ${profile.displayName}`,
    share: 'Your QR code and link, and scanning a friend’s',
    appearance: `${theme} theme · ${WALLPAPER_NAMES[appearance.wallpaper]} wallpaper`,
    privacy: [
      privacy.readReceipts ? 'Read receipts on' : 'Read receipts off',
      privacy.lastSeen ? 'last seen on' : 'last seen off',
      blocked.length ? `${blocked.length} blocked` : null,
    ]
      .filter(Boolean)
      .join(' · '),
    notifications: notificationSummary(notifications.status),
    chats: draftCount
      ? `Starred, notes to yourself · ${draftCount} unsent draft${draftCount === 1 ? '' : 's'}`
      : 'Starred messages, notes to yourself, drafts',
    typing: typingSummary(proofreadSettings.on, proofreadSettings.dialect),
    security:
      recoveryCreated === undefined
        ? 'Passphrase and recovery key'
        : recoveryCreated === null
          ? 'No recovery key yet — make one'
          : `Recovery key made ${recoveryCreated.toLocaleDateString()}`,
    storage: storageSummary(storage.estimate),
    account: 'Sign out, or delete your account',
    about: `Version ${process.env.NEXT_PUBLIC_APP_VERSION ?? 'dev'} · end-to-end encrypted`,
  };
  const section = (id: SectionId, title: string, children: React.ReactNode, tone?: 'danger') => (
    <SettingsSection
      id={id}
      title={title}
      summary={summaries[id]}
      icon={SECTION_ICONS[id]}
      open={openSections.has(id)}
      onToggle={() => toggleSection(id)}
      tone={tone}
    >
      {children}
    </SettingsSection>
  );

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

      <div className="mx-auto max-w-lg space-y-3 p-4 pb-16">
        <div className="mb-5 rounded-3xl border border-line bg-surface p-5">
          <div className="flex items-center gap-4">
            <Avatar name={profile.displayName} photoURL={myPhoto} size={64} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-lg font-semibold">{profile.displayName}</p>
              <p className="truncate text-[14px] text-muted">@{profile.username}</p>
              {profile.about?.trim() && (
                <p className="mt-0.5 truncate text-[13px] text-faint">{profile.about}</p>
              )}
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              onClick={() => openOnly('share')}
              className="flex h-11 items-center justify-center gap-2 rounded-xl bg-elevated text-[14px] font-medium text-ink transition-colors hover:bg-line"
            >
              <svg viewBox="0 0 24 24" className="size-[18px] text-zing" aria-hidden="true">
                <path d={SECTION_ICONS.share} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              My QR code
            </button>
            <button
              onClick={() => setScanning(true)}
              className="flex h-11 items-center justify-center gap-2 rounded-xl bg-zing text-[14px] font-semibold text-on-zing transition-colors hover:bg-zing-dim"
            >
              <svg viewBox="0 0 24 24" className="size-[18px]" aria-hidden="true">
                <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Scan QR code
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between px-1 pb-1">
          <p className="text-[12px] font-semibold tracking-wide text-muted uppercase">Settings</p>
          <button
            onClick={() => (openSections.size === SECTIONS.length ? closeAll() : openAll())}
            className="text-[12px] font-medium text-zing"
          >
            {openSections.size === SECTIONS.length ? 'Collapse all' : 'Expand all'}
          </button>
        </div>

        {section('profile', 'Profile', <div className="space-y-4 rounded-2xl border border-line bg-surface p-4">

          <UsernameSetting uid={profile.uid} username={profile.username} onChanged={refreshProfile} />

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
            onChange={(event) => {
              phoneEdited.current = true;
              setPhone(limitPhoneInput(event.target.value));
            }}
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
        </div>)}

        {section('share', 'Share your profile', <ShareProfileCard profile={profile} onScan={() => setScanning(true)} />)}

        {section('appearance', 'Appearance', <AppearanceSettings uid={profile.uid} />)}

        {section('privacy', 'Privacy', <PrivacySettings uid={profile.uid} photoURL={myPhoto} />)}

        {section('notifications', 'Notifications', <NotificationSettings uid={profile.uid} notifications={notifications} />)}

        {section('chats', 'Chats', <ChatsSettings uid={profile.uid} />)}

        {section('typing', 'Typing', <TypingSettings uid={profile.uid} />)}

        {section('security', 'Security', <>

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
        </>)}

        {section('storage', 'Storage', <StorageSettings storage={storage} />)}

        {section('account', 'Account', <div className="space-y-3 rounded-2xl border border-line bg-surface p-4">

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
        </div>, 'danger')}

        {section('about', 'About', <AboutSettings />)}
      </div>

      {scanning && (
        <QrScanner
          onUsername={(username) => {
            setScanning(false);
            router.push(`/u/${username}`);
          }}
          onClose={() => setScanning(false)}
        />
      )}
    </div>
  );
}
