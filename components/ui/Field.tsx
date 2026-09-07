'use client';

type Props = React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  error?: string | null;
  prefix?: string;
};

export function Field({ label, hint, error, prefix, className = '', id, ...rest }: Props) {
  const inputId = id ?? `field-${label.toLowerCase().replace(/\s+/g, '-')}`;

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
          {...rest}
          /* 16px minimum: anything smaller makes iOS zoom the viewport on focus. */
          className={`h-12 w-full bg-transparent text-[16px] text-ink
            placeholder:text-faint focus:outline-none ${className}`}
        />
      </div>

      {(error || hint) && (
        <p className={`text-[12px] ${error ? 'text-danger' : 'text-faint'}`}>{error ?? hint}</p>
      )}
    </div>
  );
}
