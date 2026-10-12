/**
 * Spelling and grammar, checked on this device by Harper (harper.js): a Rust
 * grammar engine compiled to WebAssembly, running in this page. The text goes
 * to that engine and nowhere else -- no cloud checker may ever be added here:
 * one would read every message before it was encrypted, which is exactly
 * what Zing promises nobody can do.
 *
 * The engine (about 8 MB, compressed) is fetched from this app's own origin
 * the first time someone types, then cached by the browser.
 */

export type ProofreadDialect = 'auto' | 'british' | 'american' | 'australian' | 'canadian' | 'indian';

export const DIALECTS: { value: ProofreadDialect; label: string }[] = [
  { value: 'auto', label: 'Same as this device' },
  { value: 'british', label: 'British English' },
  { value: 'american', label: 'American English' },
  { value: 'australian', label: 'Australian English' },
  { value: 'canadian', label: 'Canadian English' },
  { value: 'indian', label: 'Indian English' },
];

export type Proofread = { on: boolean; dialect: ProofreadDialect };
export const DEFAULT_PROOFREAD: Proofread = { on: true, dialect: 'auto' };

export function toProofread(value: unknown): Proofread {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    on: typeof raw.on === 'boolean' ? raw.on : DEFAULT_PROOFREAD.on,
    dialect: DIALECTS.some((option) => option.value === raw.dialect)
      ? (raw.dialect as ProofreadDialect)
      : DEFAULT_PROOFREAD.dialect,
  };
}

/** "auto" made concrete from the device's language: en-GH reads as British. */
export function resolveDialect(
  dialect: ProofreadDialect,
  locale: string,
): Exclude<ProofreadDialect, 'auto'> {
  if (dialect !== 'auto') return dialect;
  const region = locale.split(/[-_]/)[1]?.toUpperCase() ?? '';
  if (['AU', 'NZ'].includes(region)) return 'australian';
  if (region === 'CA') return 'canadian';
  if (region === 'IN') return 'indian';
  // Most of the English-speaking world outside North America spells the
  // British way, Ghana and Nigeria included.
  if (['US', 'PH', 'PR', 'LR'].includes(region) || region === '') return 'american';
  return 'british';
}

export type IssueKind = 'spelling' | 'grammar';

export type Issue = {
  start: number;
  end: number;
  /** The text the issue is about, as it was when checked. */
  text: string;
  message: string;
  kind: IssueKind;
  /** Replacements for [start, end): '' removes it. At most three. */
  suggestions: string[];
};

/** Harper's lint, the parts of it read here. */
export type RawLint = {
  kind: string;
  start: number;
  end: number;
  problem: string;
  message: string;
  suggestions: { kind: 'replace' | 'remove' | 'insertAfter'; text: string }[];
};

// Rules that are about polish rather than mistakes. In a chat they would
// nag about every "hey" at the start of a line, so they are left out.
const QUIET = new Set(['Style', 'Readability', 'Enhancement', 'Formatting', 'Regionalism']);

/**
 * Harper's findings as issues worth showing in a chat. Lints whose span does
 * not match the text they claim to be about are dropped, rather than
 * underlining the wrong letters.
 */
export function toIssues(text: string, lints: RawLint[], ignored: ReadonlySet<string> = new Set()): Issue[] {
  const issues: Issue[] = [];
  for (const lint of lints) {
    if (QUIET.has(lint.kind)) continue;
    // Sentence-start capitals are optional in a chat; "i" for "I" is not.
    if (lint.kind === 'Capitalization' && !/^i(['’](m|ve|ll|d))?$/i.test(lint.problem)) continue;
    if (text.slice(lint.start, lint.end) !== lint.problem) continue;
    if (ignored.has(ignoreKey(lint.problem, lint.message))) continue;
    const suggestions = [
      ...new Set(
        lint.suggestions.map((suggestion) =>
          suggestion.kind === 'remove'
            ? ''
            : suggestion.kind === 'insertAfter'
              ? lint.problem + suggestion.text
              : suggestion.text,
        ),
      ),
    ].slice(0, 3);
    issues.push({
      start: lint.start,
      end: lint.end,
      text: lint.problem,
      message: lint.message,
      kind: lint.kind === 'Spelling' || lint.kind === 'Typo' ? 'spelling' : 'grammar',
      suggestions,
    });
  }
  return issues.sort((a, b) => a.start - b.start);
}

/** What "Ignore" remembers: this mistake, wherever it turns up again. */
export function ignoreKey(problem: string, message: string): string {
  return `${problem.toLowerCase()}\u0000${message}`;
}

/** The text with one issue fixed, and where the caret goes after it. */
export function applyFix(text: string, issue: Issue, replacement: string): { text: string; caret: number } {
  const start = issue.start;
  let end = issue.end;
  // Removing a word should not leave two spaces behind.
  if (replacement === '' && text[end] === ' ' && (start === 0 || text[start - 1] === ' ')) end += 1;
  const next = text.slice(0, start) + replacement + text.slice(end);
  return { text: next, caret: start + replacement.length };
}

/** The issue under the caret, if any (the end of a word counts). */
export function issueAt(issues: Issue[], caret: number): Issue | null {
  return issues.find((issue) => caret >= issue.start && caret <= issue.end) ?? null;
}

// --- The engine, loaded on first use -------------------------------------

type Engine = {
  lint: (text: string) => Promise<RawLint[]>;
  setDialect: (dialect: Exclude<ProofreadDialect, 'auto'>) => Promise<void>;
  /** Replaces my words: the ones taken out of the dictionary go too. */
  setWords: (words: string[]) => Promise<void>;
};

let engine: Promise<Engine> | null = null;

function load(): Promise<Engine> {
  engine ??= (async (): Promise<Engine> => {
    const harper = await import('harper.js');
    const { binary } = await import('harper.js/binary');
    const dialects = {
      american: harper.Dialect.American,
      british: harper.Dialect.British,
      australian: harper.Dialect.Australian,
      canadian: harper.Dialect.Canadian,
      indian: harper.Dialect.Indian,
    } as const;
    // The bundler serves the .wasm from this origin; made absolute so the
    // engine fetches it from here whatever page it is asked from -- never a
    // CDN.
    const absolute = new URL(String(binary.url), window.location.href).href;
    const engineBinary = harper.createBinaryModuleFromUrl(absolute, 'full');
    // On this page rather than Harper's WorkerLinter: that one runs from a
    // blob: worker (which the CSP would have to allow) and in Chrome its
    // download of the engine was aborted mid-way. The browser compiles the
    // WebAssembly off the main thread anyway, and each check takes a few
    // milliseconds, run only once typing pauses.
    const linter = new harper.LocalLinter({ binary: engineBinary });
    await linter.setup();
    const kinds = {
      [harper.SuggestionKind.Replace]: 'replace',
      [harper.SuggestionKind.Remove]: 'remove',
      [harper.SuggestionKind.InsertAfter]: 'insertAfter',
    } as const;
    return {
      lint: async (text) =>
        (await linter.lint(text, { language: 'plaintext' })).map((lint) => {
          const span = lint.span();
          return {
            kind: lint.lint_kind(),
            start: span.start,
            end: span.end,
            problem: lint.get_problem_text(),
            message: lint.message(),
            suggestions: lint.suggestions().map((suggestion) => ({
              kind: kinds[suggestion.kind()] ?? 'replace',
              text: suggestion.get_replacement_text(),
            })),
          };
        }),
      setDialect: (dialect) => linter.setDialect(dialects[dialect]),
      setWords: async (words) => {
        await linter.clearWords();
        if (words.length) await linter.importWords(words);
      },
    };
  })().catch((cause: unknown) => {
    // Not cached: a failed load (offline on first use) can be tried again.
    engine = null;
    throw cause;
  });
  return engine;
}

/** Start fetching the engine now, so the first check is not the slow one. */
export function warmUp(): void {
  void load().catch(() => undefined);
}

let applied = { dialect: '' as string, words: '' };

/** The issues in a piece of text, with the dialect and my own words applied. */
export async function proofread(
  text: string,
  options: { dialect: Exclude<ProofreadDialect, 'auto'>; words: string[]; ignored?: ReadonlySet<string> },
): Promise<Issue[]> {
  if (!text.trim()) return [];
  const linter = await load();
  if (applied.dialect !== options.dialect) {
    await linter.setDialect(options.dialect);
    applied = { ...applied, dialect: options.dialect };
  }
  const words = options.words.join('\n');
  if (applied.words !== words) {
    await linter.setWords(options.words);
    applied = { ...applied, words };
  }
  return toIssues(text, await linter.lint(text), options.ignored);
}

// --- My dictionary: words Harper should accept, on this device only -------

const DICTIONARY = 'zing.dictionary:';

export function readDictionary(uid: string): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(DICTIONARY + uid) ?? '[]') as unknown;
    return Array.isArray(saved) ? saved.filter((word): word is string => typeof word === 'string') : [];
  } catch {
    return [];
  }
}

export function writeDictionary(uid: string, words: string[]): void {
  try {
    if (words.length) localStorage.setItem(DICTIONARY + uid, JSON.stringify([...new Set(words)]));
    else localStorage.removeItem(DICTIONARY + uid);
  } catch {
    // Private mode: the word is accepted until the tab closes.
  }
}

/** Every account's dictionary on this device. For sign-out, like drafts. */
export function clearDictionaries(): void {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(DICTIONARY)) localStorage.removeItem(key);
    }
  } catch {
    // Nothing stored, or nothing we can reach.
  }
}
