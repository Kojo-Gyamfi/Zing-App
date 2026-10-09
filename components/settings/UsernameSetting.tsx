'use client';

import { useState } from 'react';
import { changeUsername, normalizeUsername, USERNAME_PATTERN } from '@/lib/db/users';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';

/**
 * My @username, and changing it. The new handle is claimed and the old one
 * released together (lib/db/users.ts changeUsername); chats and the safety
 * number do not depend on it, but old links and QR codes to the old handle
 * stop working, so the hint says so.
 */
export function UsernameSetting({
  uid,
  username,
  onChanged,
}: {
  uid: string;
  username: string;
  onChanged: () => void | Promise<void>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const next = draft === null ? '' : normalizeUsername(draft);
  const valid = USERNAME_PATTERN.test(next);

  async function save() {
    if (draft === null) return;
    setError(null);
    if (!valid) {
      setError('3 to 20 characters: lowercase letters, numbers and _.');
      return;
    }
    if (next === username) {
      setDraft(null);
      return;
    }
    // A transaction cannot run offline; say so rather than spin.
    if (!navigator.onLine) {
      setError('You’re offline. Connect, then change it.');
      return;
    }
    setBusy(true);
    try {
      await changeUsername(uid, username, next);
      await onChanged();
      setDraft(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (cause) {
      setError(
        (cause as Error).message === 'USERNAME_TAKEN'
          ? `@${next} is taken. Try another.`
          : 'Could not change it. Check your connection and try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (draft === null) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3">
        <div className="min-w-0">
          <p className="text-[12px] text-muted">Username</p>
          <p className="truncate text-[15px] text-ink">@{username}</p>
          {saved && <p className="text-[12px] text-zing">Username changed</p>}
        </div>
        <button
          onClick={() => {
            setDraft(username);
            setError(null);
          }}
          className="shrink-0 text-[13px] font-medium text-zing"
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-2xl border border-line bg-surface p-4">
      <Field
        label="New username"
        hint="People find you by it. Your chats stay as they are, but links and QR codes to the old one stop working, and someone else can take it."
        value={draft}
        onChange={(event) => setDraft(event.target.value.toLowerCase().replace(/\s/g, ''))}
        onKeyDown={(event) => event.key === 'Enter' && void save()}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        maxLength={21}
        autoFocus
        error={error}
      />
      <div className="flex gap-2">
        <Button variant="ghost" onClick={() => setDraft(null)} disabled={busy}>
          Cancel
        </Button>
        <Button onClick={() => void save()} busy={busy} disabled={!valid || next === username}>
          Save username
        </Button>
      </div>
    </div>
  );
}
