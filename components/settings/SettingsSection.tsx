'use client';

/**
 * One collapsible group of settings: a row with an icon, a title and a
 * one-line summary of what is set now ("Dark · Doodles"), opening to the
 * controls below it. The page keeps which ones are open (see useOpenSections).
 */
export function SettingsSection({
  id,
  title,
  summary,
  icon,
  open,
  onToggle,
  tone = 'default',
  children,
}: {
  id: string;
  title: string;
  /** What is set now, in a few words; shown while closed and open. */
  summary?: string;
  /** An SVG path, 24x24, stroked. */
  icon: string;
  open: boolean;
  onToggle: () => void;
  tone?: 'default' | 'danger';
  children: React.ReactNode;
}) {
  const panel = `${id}-panel`;
  return (
    <section id={id} className="scroll-mt-20">
      <h2>
        <button
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={panel}
          className={`flex w-full items-center gap-3.5 rounded-2xl border border-line bg-surface px-4 py-3.5 text-left
            transition-colors hover:bg-elevated ${open ? 'rounded-b-md' : ''}`}
        >
          <span
            className={`grid size-9 shrink-0 place-items-center rounded-xl
              ${tone === 'danger' ? 'bg-danger/12 text-danger' : 'bg-zing/12 text-zing'}`}
          >
            <svg viewBox="0 0 24 24" className="size-[18px]" aria-hidden="true">
              <path d={icon} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold text-ink">{title}</span>
            {summary && <span className="block truncate text-[12px] text-muted">{summary}</span>}
          </span>
          <svg
            viewBox="0 0 24 24"
            className={`size-5 shrink-0 text-muted transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </h2>
      {/* Grid rows animate from 0fr to 1fr: a height transition without
          measuring. Closed content is inert, so Tab skips what is hidden. */}
      <div
        id={panel}
        role="region"
        aria-label={title}
        inert={!open}
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out
          ${open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="space-y-3 pt-2 pb-1">{children}</div>
        </div>
      </div>
    </section>
  );
}

/** Icons for the sections, so the page reads as a list of words. */
export const SECTION_ICONS = {
  profile: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20a8 8 0 0 1 16 0',
  share: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2zM18 14h2M14 18h2v2',
  appearance: 'M12 3a9 9 0 0 0 0 18c1.2 0 1.8-.9 1.4-2a2 2 0 0 1 1.9-2.7H17a4 4 0 0 0 4-4C21 6.8 17 3 12 3zM7.5 11h.01M10 7.5h.01M15 7.5h.01',
  privacy: 'M12 3 5 6v5c0 4.5 3 8.4 7 10 4-1.6 7-5.5 7-10V6zM9.5 12l2 2 3.5-3.5',
  notifications: 'M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0',
  chats: 'M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-4 3v-3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z',
  security: 'M6 11V8a6 6 0 0 1 12 0v3M5 11h14v10H5zM12 15v2',
  storage: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6',
  account: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H3',
  about: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01',
} as const;
