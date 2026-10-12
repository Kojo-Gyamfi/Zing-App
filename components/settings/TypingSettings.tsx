'use client';

import { useState } from 'react';
import { useAccount } from '@/lib/store/account';
import { setProofread } from '@/lib/db/prefs';
import { DIALECTS, readDictionary, resolveDialect, writeDictionary } from '@/lib/proofread';
import { Toggle } from './Toggle';

const LABELS: Record<string, string> = Object.fromEntries(
  DIALECTS.map((option) => [option.value, option.label]),
);

export function typingSummary(on: boolean, dialect: string): string {
  if (!on) return 'Spelling & grammar check off';
  const resolved = resolveDialect(dialect as never, typeof navigator === 'undefined' ? 'en' : navigator.language);
  return `Spelling & grammar on · ${LABELS[resolved]}`;
}

/**
 * Spelling and grammar while typing. The check runs on this device
 * (lib/proofread.ts); the setting follows the account, the words added to
 * the dictionary stay on this device.
 */
export function TypingSettings({ uid }: { uid: string }) {
  const known = useAccount((state) => state.known);
  const { on, dialect } = useAccount((state) => state.settings.proofread);
  const [words, setWords] = useState(() => readDictionary(uid));
  const [error, setError] = useState<string | null>(null);

  function save(patch: Parameters<typeof setProofread>[1]) {
    setError(null);
    setProofread(uid, patch).catch(() => setError('Could not save. Check your connection and try again.'));
  }

  return (
    <div className="space-y-3">
      <div className="divide-y divide-line rounded-2xl border border-line bg-surface">
        <Toggle
          label="Check spelling & grammar"
          hint="Mistakes are underlined as you type — red for spelling, blue for grammar. Tap one for a fix. Checked on this device: your messages never leave it to be checked."
          on={on}
          disabled={!known}
          onChange={(next) => save({ on: next })}
        />

        <div className="space-y-2.5 p-4">
          <div>
            <p className="text-[14px] font-medium text-ink">English</p>
            <p className="mt-1 text-[12px] leading-relaxed text-faint">
              Which spelling counts as right — colour or color.
              {dialect === 'auto' && ` This device uses ${LABELS[resolveDialect('auto', navigator.language)]}.`}
            </p>
          </div>
          <select
            value={dialect}
            disabled={!known || !on}
            onChange={(event) => save({ dialect: event.target.value as typeof dialect })}
            aria-label="Which English to check against"
            className="h-10 w-full rounded-xl bg-elevated px-3 text-[14px] text-ink focus:outline-none
              focus:ring-1 focus:ring-zing disabled:opacity-50"
          >
            {DIALECTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-3 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[14px] font-medium text-ink">My dictionary</p>
              <p className="mt-1 text-[12px] leading-relaxed text-faint">
                Words you added with “Add to dictionary”: names, slang, other languages. Kept on
                this device only.
              </p>
            </div>
            <span className="shrink-0 text-[14px] font-medium text-ink tabular-nums">{words.length}</span>
          </div>
          {words.length > 0 && (
            <>
              <p className="text-[13px] leading-relaxed break-words text-muted">
                {words.slice(0, 30).join(', ')}
                {words.length > 30 && ` and ${words.length - 30} more`}
              </p>
              <button
                onClick={() => {
                  writeDictionary(uid, []);
                  setWords([]);
                }}
                className="h-9 rounded-full bg-elevated px-4 text-[13px] font-medium text-danger"
              >
                Clear dictionary
              </button>
            </>
          )}
        </div>
      </div>
      {error && <p className="text-[12px] text-danger">{error}</p>}
    </div>
  );
}
