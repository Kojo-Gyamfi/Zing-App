'use client';

import { DISAPPEARING_OPTIONS } from '@/lib/db/schema';

/** "24 hours", "7 days", "90 days"; "Off" for 0. */
export function disappearingLabel(seconds: number): string {
  if (!seconds) return 'Off';
  const days = Math.round(seconds / 86_400);
  return days === 1 ? '24 hours' : `${days} days`;
}

/** A stopwatch: the disappearing-messages mark, as on WhatsApp. */
export function DisappearingIcon({ className = 'size-4', label }: { className?: string; label?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      role={label ? 'img' : undefined}
      aria-label={label ? `Disappearing messages: ${label}` : undefined}
      aria-hidden={label ? undefined : true}
    >
      <path
        d="M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 9v4l2.5 2M10 2h4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Off / 24 hours / 7 days / 90 days. Without onChange it is read-only. */
export function DisappearingPicker({
  value,
  onChange,
}: {
  value: number;
  onChange?: (seconds: number) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Disappearing messages" className="grid grid-cols-4 gap-1.5">
      {DISAPPEARING_OPTIONS.map((seconds) => (
        <button
          key={seconds}
          role="radio"
          aria-checked={value === seconds}
          disabled={!onChange}
          onClick={() => value !== seconds && onChange?.(seconds)}
          className={`h-9 rounded-xl text-[13px] font-medium transition-colors disabled:opacity-60
            ${value === seconds ? 'bg-zing text-on-zing' : 'bg-elevated text-muted hover:text-ink'}`}
        >
          {disappearingLabel(seconds).replace(' hours', 'h').replace(' days', 'd')}
        </button>
      ))}
    </div>
  );
}
