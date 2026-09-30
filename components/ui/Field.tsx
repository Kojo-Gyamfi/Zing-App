'use client';

import { useState } from 'react';

type Props = React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  error?: string | null;
  prefix?: string;
};

export function Field({ label, hint, error, prefix, className = '', id, type, ...rest }: Props) {
  const inputId = id ?? `field-${label.toLowerCase().replace(/\s+/g, '-')}`;

  // Password fields get a reveal toggle so a passphrase can be checked before
  // it is committed -- a typo here is unrecoverable.
  const isPassword = type === 'password';
  const [revealed, setRevealed] = useState(false);

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-[13px] font-medium text-muted">
        {label}
      </label>

      <div
        className={`flex items-center gap-1 rounded-2xl border bg-surface px-4
          transition-colors focus-within:border-zing
          ${error ? 'border-danger' : 'border-line'}`}
      >
        {prefix && <span className="text-muted select-none">{prefix}</span>}
        <input
          id={inputId}
          type={isPassword && revealed ? 'text' : type}
          {...rest}
          /* 16px minimum: anything smaller makes iOS zoom the viewport on focus. */
          className={`h-12 w-full bg-transparent text-[16px] text-ink
            placeholder:text-faint focus:outline-none ${className}`}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setRevealed((value) => !value)}
            aria-label={revealed ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
            aria-pressed={revealed}
            className="-mr-2 grid size-10 shrink-0 place-items-center rounded-full text-muted
              transition-colors hover:text-ink"
          >
            <svg
              viewBox="0 0 24 24"
              className="size-5"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
              <circle cx="12" cy="12" r="3" />
              {revealed && <path d="M3 3l18 18" />}
            </svg>
          </button>
        )}
      </div>

      {(error || hint) && (
        <p className={`text-[12px] ${error ? 'text-danger' : 'text-faint'}`}>{error ?? hint}</p>
      )}
    </div>
  );
}
