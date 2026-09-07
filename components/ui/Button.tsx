'use client';

import { Spinner } from './Spinner';

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'danger';
  busy?: boolean;
};

const VARIANTS = {
  primary: 'bg-zing text-on-zing hover:bg-zing-dim active:scale-[0.98]',
  ghost: 'bg-elevated text-ink hover:bg-line active:scale-[0.98]',
  danger: 'bg-transparent text-danger hover:bg-danger/10',
} as const;

export function Button({ variant = 'primary', busy, children, className = '', ...rest }: Props) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || busy}
      className={`inline-flex h-12 items-center justify-center gap-2 rounded-2xl px-5
        text-[15px] font-semibold transition-[background-color,transform] duration-150
        disabled:pointer-events-none disabled:opacity-40
        focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zing
        ${VARIANTS[variant]} ${className}`}
    >
      {busy && <Spinner />}
      {children}
    </button>
  );
}
