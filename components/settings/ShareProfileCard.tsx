'use client';

import { useState } from 'react';
import { profileLink, shareProfile } from '@/lib/share';
import { Button } from '@/components/ui/Button';
import { ProfileQr } from '@/components/ProfileQr';
import type { UserDoc } from '@/lib/db/schema';

/**
 * Your own profile link, as a QR code and through the share sheet -- the same
 * link the profile sheet shares for other people. It carries only the
 * @username, which is public already. Scanning someone else's code is right
 * beside it, the way people swap codes in person.
 */
export function ShareProfileCard({ profile, onScan }: { profile: UserDoc; onScan: () => void }) {
  // Settings renders only once the profile has loaded in the browser, so the
  // origin is always there to build the link from.
  const link = profileLink(profile.username);
  const [notice, setNotice] = useState<string | null>(null);

  function flash(text: string) {
    setNotice(text);
    setTimeout(() => setNotice(null), 2000);
  }

  async function share() {
    if ((await shareProfile(profile)) === 'copied') flash('Link copied');
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      flash('Link copied');
    } catch {
      flash('Could not copy');
    }
  }

  return (
    <div className="space-y-4 rounded-2xl border border-line bg-surface p-4">
      <p className="text-[12px] leading-relaxed text-faint">
        Anyone who scans the code or opens the link can start a chat with you. They see your name,
        @username, about and photo (if you share it) — never your phone number.
      </p>

      <div className="flex flex-col items-center gap-2">
        <ProfileQr url={link} size={208} />
        <button
          onClick={() => void copy()}
          aria-label="Copy profile link"
          className="text-center text-[12px] break-all text-muted underline-offset-2 hover:underline"
        >
          {link}
        </button>
      </div>

      <div className="flex gap-2">
        <Button variant="ghost" onClick={onScan} className="flex-1">
          Scan a code
        </Button>
        <Button onClick={() => void share()} className="flex-1">
          Share link
        </Button>
      </div>
      {notice && (
        <p role="status" className="text-center text-[12px] text-zing">
          {notice}
        </p>
      )}
    </div>
  );
}
