'use client';

/** An on/off switch with a label and a line of explanation. */
export function Toggle({
  label,
  hint,
  on,
  disabled,
  onChange,
  bare = false,
}: {
  label: string;
  hint: string;
  on: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
  /** No padding of its own, for a row that already has some. */
  bare?: boolean;
}) {
  return (
    <button
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`flex w-full items-start gap-4 text-left disabled:opacity-50 ${bare ? '' : 'p-4'}`}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-medium text-ink">{label}</span>
        <span className="mt-1 block text-[12px] leading-relaxed text-faint">{hint}</span>
      </span>
      <span
        aria-hidden="true"
        className={`relative mt-0.5 h-6 w-10 shrink-0 rounded-full transition-colors ${on ? 'bg-zing' : 'bg-line'}`}
      >
        <span
          className={`absolute top-0.5 size-5 rounded-full bg-white shadow-sm transition-[left] ${on ? 'left-[18px]' : 'left-0.5'}`}
        />
      </span>
    </button>
  );
}
