'use client';

import { useState } from 'react';
import { profileLink, shareProfile } from '@/lib/share';
import { Button } from '@/components/ui/Button';
import { ProfileQr } from '@/components/ProfileQr';
import type { UserDoc } from '@/lib/db/schema';

/**
 * Your own profile link, as a QR code and through the share sheet -- the same
 * link the profile sheet shares for other people. It carries only the
 * @username, which is public already.
 */
export function ShareProfileCard({ profile }: { profile: UserDoc }) {
  // Built on demand: the origin is only known in the browser.
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function share() {
    if ((await shareProfile(profile)) === 'copied') {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-[13px] font-semibold tracking-wide text-muted uppercase">
        Share your profile
      </h2>

      <div className="space-y-4 rounded-2xl border border-line bg-surface p-4">
        <p className="text-[12px] leading-relaxed text-faint">
          Anyone who scans the code or opens the link can start a chat with you. They see your
          name, @username, about and photo (if you share it) — never your phone number.
        </p>

        {link && (
          <div className="flex flex-col items-center gap-2">
            <ProfileQr url={link} size={208} />
            <p className="text-center text-[12px] break-all text-muted">{link}</p>
          </div>
        )}

        <div className="flex gap-2">
          <Button
            variant="ghost"
            onClick={() => setLink(link ? null : profileLink(profile.username))}
            className="flex-1"
          >
            {link ? 'Hide QR code' : 'Show QR code'}
          </Button>
          <Button onClick={() => void share()} className="flex-1">
            {copied ? 'Link copied' : 'Share link'}
          </Button>
        </div>
      </div>
    </section>
  );
}
