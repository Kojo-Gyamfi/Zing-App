'use client';

/**
 * The menu sheet: a bottom sheet on a phone, a card in the middle from md up.
 * Tapping outside closes it.
 */
export function Sheet({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm md:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label={label}
        onClick={(event) => event.stopPropagation()}
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto scroll-thin rounded-t-3xl border-t border-line bg-surface p-3
          pb-[max(0.75rem,env(safe-area-inset-bottom))] md:rounded-3xl md:border"
      >
        {children}
      </div>
    </div>
  );
}

/** A sheet's heading, with a back arrow when it is a step inside a menu. */
export function SheetTitle({ children, onBack }: { children: React.ReactNode; onBack?: () => void }) {
  return (
    <div className="mx-1 mt-1 mb-2 flex min-h-10 items-center gap-1">
      {onBack && (
        <button
          onClick={onBack}
          aria-label="Back"
          className="grid size-9 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-elevated hover:text-ink"
        >
          <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
            <path d="M15 5 8 12l7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      <p className={`truncate text-[15px] font-semibold ${onBack ? '' : 'px-2'}`}>{children}</p>
    </div>
  );
}

/** One action: an icon (an SVG path), a label and an optional hint under it. */
export function SheetItem({
  label,
  hint,
  icon,
  disabled,
  danger,
  className = '',
  onClick,
}: {
  label: string;
  hint?: string;
  icon: string;
  disabled?: boolean;
  danger?: boolean;
  className?: string;
  onClick: () => void;
}) {
  return (
    <li className={className}>
      <button
        onClick={onClick}
        disabled={disabled}
        className={`flex min-h-12 w-full items-center gap-4 rounded-2xl px-3 py-2 text-left text-[15px]
          transition-colors hover:bg-elevated disabled:opacity-50 disabled:hover:bg-transparent
          ${danger ? 'text-danger' : 'text-ink'}`}
      >
        <svg viewBox="0 0 24 24" className="size-5 shrink-0" aria-hidden="true">
          <path d={icon} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>
          {label}
          {hint && <span className="block text-[12px] text-muted">{hint}</span>}
        </span>
      </button>
    </li>
  );
}

/** Icons shared by the chat-list menu and the menu inside a chat. */
export const ICONS = {
  pin: 'M9 4h6l-1 5 3 3v2H7v-2l3-3zM12 14v6',
  favourite: 'M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z',
  mute: 'M6 16V11a6 6 0 0 1 9-5.2M18 11v5l1.5 2H8M10 20a2 2 0 0 0 4 0M4 4l16 16',
  unmute: 'M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0',
  archive: 'M4 5h16v4H4zM5 9v10h14V9M10 13h4',
} as const;
