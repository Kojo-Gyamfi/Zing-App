'use client';

import { useRef, useState } from 'react';
import { EMOJI_CATEGORIES } from './emojiData';
import { searchEmoji, type EmojiEntry } from '@/lib/emojiSearch';

const RECENT_KEY = 'zing.emoji.recent';
const RECENT_MAX = 24;

/** Recently used emoji stay on this device, like drafts. */
function loadRecent(): string[] {
  try {
    const stored = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(stored) ? stored.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

// The words to search by (~90 KB) load the first time someone searches, from
// this app like the rest of it, and stay for the session. A search is never
// sent anywhere.
let keywords: Promise<readonly EmojiEntry[]> | null = null;
function loadKeywords() {
  keywords ??= import('./emojiKeywords').then((module) => module.EMOJI_KEYWORDS);
  return keywords;
}

const EMOJI_BUTTON =
  'grid aspect-square place-items-center rounded-lg text-[26px] leading-none transition-transform hover:bg-line active:scale-90';

/**
 * WhatsApp-style emoji panel: sits under the input in place of the keyboard,
 * a search box, category tabs, and a backspace key that removes a whole emoji.
 */
export function EmojiPanel({
  onPick,
  onBackspace,
}: {
  onPick: (emoji: string) => void;
  /** Composer only; a reaction picker has nothing to delete. */
  onBackspace?: () => void;
}) {
  // Only mounted after the person taps the emoji button, so storage is
  // available and there is no server render to match.
  const [recent] = useState(loadRecent);
  const [active, setActive] = useState(recent.length ? 'recent' : EMOJI_CATEGORIES[0].id);
  const scroller = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [table, setTable] = useState<readonly EmojiEntry[] | null>(null);
  const searching = query.trim().length > 0;
  const results = searching && table ? searchEmoji(table, query) : [];
  const names = new Map(table?.map(([emoji, name]) => [emoji, name]));

  const sections = [
    ...(recent.length ? [{ id: 'recent', label: 'Recent', icon: '🕘', emoji: recent }] : []),
    ...EMOJI_CATEGORIES,
  ];

  function prepareSearch() {
    if (!table) void loadKeywords().then(setTable);
  }

  function pick(emoji: string) {
    onPick(emoji);
    const next = [emoji, ...recent.filter((item) => item !== emoji)].slice(0, RECENT_MAX);
    // The Recent row is not reshuffled under the person's finger mid-tap;
    // the new order shows the next time the panel opens.
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      // No storage: recents just are not remembered.
    }
  }

  function jumpTo(id: string) {
    setActive(id);
    const section = scroller.current?.querySelector<HTMLElement>(`[data-section="${id}"]`);
    if (section && scroller.current) scroller.current.scrollTop = section.offsetTop;
  }

  // Highlight the tab of whichever section is at the top while scrolling.
  function onScroll() {
    const node = scroller.current;
    if (!node) return;
    let current: string | undefined = sections[0]?.id;
    for (const section of node.querySelectorAll<HTMLElement>('[data-section]')) {
      if (section.offsetTop <= node.scrollTop + 8) current = section.dataset.section ?? current;
    }
    if (current && current !== active) setActive(current);
  }

  return (
    <div data-emoji-panel className="mt-2 flex h-[312px] flex-col overflow-hidden rounded-2xl bg-elevated">
      <div className="flex items-center gap-1 px-2 pt-2">
        <label
          className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-full bg-surface px-3 text-muted
            focus-within:ring-2 focus-within:ring-zing/50"
        >
          <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(event) => {
              prepareSearch();
              setQuery(event.target.value);
            }}
            onFocus={prepareSearch}
            onKeyDown={(event) => {
              // Enter takes the best match; Escape clears the search before
              // it closes anything.
              if (event.key === 'Enter') {
                event.preventDefault();
                if (results[0]) pick(results[0]);
              } else if (event.key === 'Escape' && query) {
                event.preventDefault();
                event.stopPropagation();
                setQuery('');
              }
            }}
            placeholder="Search emoji"
            aria-label="Search emoji"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            maxLength={40}
            className="min-w-0 flex-1 bg-transparent text-[16px] text-ink outline-none placeholder:text-faint
              [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="grid size-6 shrink-0 place-items-center rounded-full hover:text-ink"
            >
              <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          )}
        </label>
        {onBackspace && (
          <button
            type="button"
            onClick={onBackspace}
            aria-label="Delete"
            className="grid size-10 shrink-0 place-items-center rounded-full text-muted hover:text-ink"
          >
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1Z" />
              <path d="m17.5 9.5-5 5M12.5 9.5l5 5" />
            </svg>
          </button>
        )}
      </div>

      {searching ? (
        <div className="flex-1 overflow-y-auto px-2 pb-2 scroll-thin">
          {!table ? (
            <p className="pt-6 text-center text-[13px] text-faint">Searching…</p>
          ) : results.length === 0 ? (
            <p className="pt-6 text-center text-[13px] text-faint">No emoji found</p>
          ) : (
            <section aria-label="Emoji found">
              <h3 className="px-1 pt-2 pb-1 text-[12px] font-medium text-muted">Search results</h3>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(2.5rem,1fr))]">
                {results.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    // Focus stays in the search box, so one search can pick
                    // several, and a phone's keyboard doesn't drop and come back.
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => pick(emoji)}
                    title={names.get(emoji)}
                    aria-label={`${emoji} ${names.get(emoji) ?? ''}`.trim()}
                    className={EMOJI_BUTTON}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      ) : (
        <>
          <div className="mt-1 flex border-b border-line px-1" role="tablist" aria-label="Emoji categories">
            <div className="flex flex-1 overflow-x-auto scroll-thin">
              {sections.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  role="tab"
                  aria-selected={active === section.id}
                  aria-label={section.label}
                  title={section.label}
                  onClick={() => jumpTo(section.id)}
                  className={`grid h-10 min-w-10 shrink-0 place-items-center border-b-2 text-[20px] transition-[opacity,border-color]
                    ${active === section.id ? 'border-zing opacity-100' : 'border-transparent opacity-50 hover:opacity-80'}`}
                >
                  {section.icon}
                </button>
              ))}
            </div>
          </div>

          <div ref={scroller} onScroll={onScroll} className="relative flex-1 overflow-y-auto px-2 pb-2 scroll-thin">
            {sections.map((section) => (
              <section key={section.id} data-section={section.id}>
                <h3 className="sticky top-0 z-[1] bg-elevated px-1 pt-2 pb-1 text-[12px] font-medium text-muted">
                  {section.label}
                </h3>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(2.5rem,1fr))]">
                  {section.emoji.map((emoji) => (
                    <button key={emoji} type="button" onClick={() => pick(emoji)} className={EMOJI_BUTTON}>
                      {emoji}
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
