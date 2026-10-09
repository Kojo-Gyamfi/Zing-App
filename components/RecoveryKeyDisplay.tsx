'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';

type Props = {
  recoveryKey: string;
  username: string;
};

/**
 * The recovery key, shown exactly once. Large and monospace so it survives
 * being copied onto paper, with Copy and Download for people who keep it in a
 * password manager instead.
 */
export function RecoveryKeyDisplay({ recoveryKey, username }: Props) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(recoveryKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (insecure origin, permissions): the key is still on screen.
    }
  }

  function download() {
    const text = [
      'Zing recovery key',
      `Account: @${username}`,
      '',
      recoveryKey,
      '',
      'If you forget your passphrase, this key is the only other way back into',
      'your messages. Keep it somewhere private. Zing cannot show it again.',
      '',
    ].join('\n');

    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `zing-recovery-key-${username}.txt`;
    // In the page, and revoked a moment later: Safari downloads nothing from
    // a detached link or a blob URL revoked in the same tick.
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-x-3 gap-y-2 rounded-2xl border border-line bg-surface p-4 text-center font-mono text-[18px] font-semibold tracking-wider text-ink select-all">
        {recoveryKey.split('-').map((group, index) => (
          <span key={index}>{group}</span>
        ))}
      </div>

      <div className="flex gap-2">
        <Button variant="ghost" onClick={() => void copy()} className="flex-1">
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button variant="ghost" onClick={download} className="flex-1">
          Download .txt
        </Button>
      </div>
    </div>
  );
}
