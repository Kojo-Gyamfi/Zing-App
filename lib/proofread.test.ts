import { describe, expect, it } from 'vitest';
import {
  applyFix,
  ignoreKey,
  issueAt,
  resolveDialect,
  toIssues,
  toProofread,
  type RawLint,
} from './proofread';

const lint = (extra: Partial<RawLint> & Pick<RawLint, 'start' | 'end' | 'problem'>): RawLint => ({
  kind: 'Typo',
  message: 'Did you mean the definite article?',
  suggestions: [{ kind: 'replace', text: 'the' }],
  ...extra,
});

describe('which English', () => {
  it('follows the device, British for Ghana', () => {
    expect(resolveDialect('auto', 'en-GH')).toBe('british');
    expect(resolveDialect('auto', 'en-GB')).toBe('british');
    expect(resolveDialect('auto', 'en-US')).toBe('american');
    expect(resolveDialect('auto', 'en')).toBe('american');
    expect(resolveDialect('auto', 'en-AU')).toBe('australian');
    expect(resolveDialect('auto', 'en_CA')).toBe('canadian');
    expect(resolveDialect('auto', 'en-IN')).toBe('indian');
    expect(resolveDialect('american', 'en-GB')).toBe('american');
  });

  it('reads the saved setting, defaults filled in', () => {
    expect(toProofread(undefined)).toEqual({ on: true, dialect: 'auto' });
    expect(toProofread({ on: false, dialect: 'british' })).toEqual({ on: false, dialect: 'british' });
    expect(toProofread({ on: 'yes', dialect: 'klingon' })).toEqual({ on: true, dialect: 'auto' });
  });
});

describe('issues worth showing in a chat', () => {
  const text = 'hey i has teh cat';

  it('keeps mistakes, drops polish, and labels spelling apart from grammar', () => {
    const issues = toIssues(text, [
      lint({ kind: 'Capitalization', start: 0, end: 3, problem: 'hey', suggestions: [{ kind: 'replace', text: 'Hey' }] }),
      lint({ kind: 'Capitalization', start: 4, end: 5, problem: 'i', suggestions: [{ kind: 'replace', text: 'I' }] }),
      lint({ kind: 'Agreement', start: 6, end: 9, problem: 'has', suggestions: [{ kind: 'replace', text: 'have' }] }),
      lint({ start: 10, end: 13, problem: 'teh' }),
      lint({ kind: 'Style', start: 14, end: 17, problem: 'cat' }),
    ]);
    expect(issues.map((issue) => [issue.text, issue.kind])).toEqual([
      ['i', 'grammar'],
      ['has', 'grammar'],
      ['teh', 'spelling'],
    ]);
  });

  it('drops a lint whose span does not match its text, rather than mark the wrong letters', () => {
    expect(toIssues(text, [lint({ start: 9, end: 12, problem: 'teh' })])).toEqual([]);
  });

  it('turns removals and insertions into plain replacements, without repeats', () => {
    const [issue] = toIssues('so so good', [
      lint({
        kind: 'Repetition',
        start: 0,
        end: 2,
        problem: 'so',
        suggestions: [
          { kind: 'remove', text: '' },
          { kind: 'insertAfter', text: ',' },
          { kind: 'remove', text: '' },
        ],
      }),
    ]);
    expect(issue.suggestions).toEqual(['', 'so,']);
  });

  it('leaves out what was ignored', () => {
    const ignored = new Set([ignoreKey('TEH', 'Did you mean the definite article?')]);
    expect(toIssues(text, [lint({ start: 10, end: 13, problem: 'teh' })], ignored)).toEqual([]);
  });
});

describe('fixing', () => {
  const issue = { start: 8, end: 11, text: 'teh', message: '', kind: 'spelling' as const, suggestions: ['the'] };

  it('splices the replacement in and puts the caret after it', () => {
    expect(applyFix('this is teh best', issue, 'the')).toEqual({ text: 'this is the best', caret: 11 });
  });

  it('takes a removed word’s space with it', () => {
    const repeat = { ...issue, start: 3, end: 5, text: 'so' };
    expect(applyFix('so so good', repeat, '')).toEqual({ text: 'so good', caret: 3 });
  });

  it('finds the issue under the caret, the end of the word included', () => {
    expect(issueAt([issue], 9)).toBe(issue);
    expect(issueAt([issue], 11)).toBe(issue);
    expect(issueAt([issue], 12)).toBeNull();
  });
});

describe('the real engine, on this machine', () => {
  it('finds a typo and a grammar slip, with spans in JavaScript string units', async () => {
    const harper = await import('harper.js');
    // Inlined: Node cannot fetch the separate .wasm the browser build uses.
    const { binaryInlined } = await import('harper.js/binaryInlined');
    const linter = new harper.LocalLinter({ binary: binaryInlined, dialect: harper.Dialect.British });
    const text = '😀 meet me their, teh cat';
    const raw = (await linter.lint(text, { language: 'plaintext' })).map((found) => ({
      kind: found.lint_kind(),
      start: found.span().start,
      end: found.span().end,
      problem: found.get_problem_text(),
      message: found.message(),
      suggestions: found.suggestions().map((suggestion) => ({
        kind: 'replace' as const,
        text: suggestion.get_replacement_text(),
      })),
    }));
    const issues = toIssues(text, raw);
    expect(issues.find((issue) => issue.text === 'teh')?.suggestions).toContain('the');
    expect(issues.find((issue) => issue.text === 'their')?.suggestions).toContain('there');
    await linter.dispose();
  }, 60_000);
});
