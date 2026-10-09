'use client';

import { MUTE_CHOICES, type MuteDuration } from '@/lib/mute';

/**
 * Mute for 8 hours, a week or always; or unmute. A step of its own in both
 * chat menus (the list's long-press one and the one inside a chat).
 */
export function MutePicker({
  status,
  onChoose,
}: {
  /** "Muted until ..." when muted, null when not. */
  status: string | null;
  onChoose: (duration: MuteDuration | null) => void;
}) {
  return (
    <div className="space-y-3 px-2 pb-1">
      <p className="text-[13px] leading-relaxed text-muted">
        {status ?? 'No push notifications from this chat. Messages still arrive.'}
      </p>
      <div role="group" aria-label="Mute for" className="flex flex-col gap-1.5">
        {MUTE_CHOICES.map((choice) => (
          <button
            key={choice.value}
            onClick={() => onChoose(choice.value)}
            className="h-11 rounded-xl bg-elevated px-4 text-left text-[15px] text-ink transition-colors hover:bg-line"
          >
            {choice.label}
          </button>
        ))}
        {status && (
          <button
            onClick={() => onChoose(null)}
            className="h-11 rounded-xl px-4 text-left text-[15px] font-medium text-zing transition-colors hover:bg-elevated"
          >
            Unmute
          </button>
        )}
      </div>
    </div>
  );
}
