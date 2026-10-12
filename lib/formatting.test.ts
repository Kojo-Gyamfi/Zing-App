import { describe, expect, it } from 'vitest';
import { formatText, plainText, type FormattedRun } from './formatting';
import { DEFAULT_APPEARANCE, toAppearance } from './appearance';

/** Runs without their offsets, which most cases do not care about. */
const runs = (text: string, search?: string) =>
  formatText(text, search).map((run: FormattedRun) => {
    const { start, ...rest } = run;
    void start;
    return rest;
  });

describe('message formatting', () => {
  it('styles WhatsApp markers and drops them', () => {
    expect(runs('a *bold* b')).toEqual([
      { text: 'a ' },
      { text: 'bold', bold: true },
      { text: ' b' },
    ]);
    expect(runs('_it_ ~gone~')).toEqual([
      { text: 'it', italic: true },
      { text: ' ' },
      { text: 'gone', strike: true },
    ]);
  });

  it('nests different markers', () => {
    expect(runs('*_both_ bold*')).toEqual([
      { text: 'both', bold: true, italic: true },
      { text: ' bold', bold: true },
    ]);
  });

  it('leaves markers alone inside words, around spaces and across lines', () => {
    for (const text of ['snake_case_name', '2*3*4', '* not bold *', '*one\ntwo*', '**', 'a*b']) {
      expect(plainText(text)).toBe(text);
    }
  });

  it('allows punctuation around markers', () => {
    expect(runs('(*yes*)!')).toEqual([{ text: '(' }, { text: 'yes', bold: true }, { text: ')!' }]);
  });

  it('keeps code literal, inline and fenced', () => {
    expect(runs('run `*not bold*` now')).toEqual([
      { text: 'run ' },
      { text: '*not bold*', code: true },
      { text: ' now' },
    ]);
    expect(runs('```a\n_b_```')).toEqual([{ text: 'a\n_b_', code: true }]);
    for (const text of ['``', '` `', '``` ```']) expect(plainText(text)).toBe(text);
  });

  it('does not break links, even ones full of markers', () => {
    expect(runs('see https://example.com/a_b_c ok')).toEqual([
      { text: 'see ' },
      { text: 'https://example.com/a_b_c', href: 'https://example.com/a_b_c' },
      { text: ' ok' },
    ]);
  });

  it('formats a link wrapped in markers, without the marker in the link', () => {
    expect(runs('*https://example.com*')).toEqual([
      { text: 'https://example.com', bold: true, href: 'https://example.com/' },
    ]);
  });

  it('never links a URL inside code', () => {
    expect(runs('`https://example.com`')).toEqual([{ text: 'https://example.com', code: true }]);
  });

  it('highlights search hits through formatting, at the right offsets', () => {
    const result = formatText('say *hello* there', 'ell');
    expect(result.map(({ text, match, bold }) => ({ text, match, bold }))).toEqual([
      { text: 'say ', match: undefined, bold: undefined },
      { text: 'h', match: undefined, bold: true },
      { text: 'ell', match: true, bold: true },
      { text: 'o', match: undefined, bold: true },
      { text: ' there', match: undefined, bold: undefined },
    ]);
    // Offsets point into the original text, markers included.
    expect(result[2].start).toBe(6);
  });

  it('leaves plain text as one run', () => {
    expect(runs('just words')).toEqual([{ text: 'just words' }]);
  });
});

describe('appearance', () => {
  it('fills in and cleans up whatever was stored', () => {
    expect(toAppearance(undefined)).toEqual(DEFAULT_APPEARANCE);
    expect(toAppearance({ theme: 'light' })).toEqual({ ...DEFAULT_APPEARANCE, theme: 'light' });
    expect(toAppearance({ theme: 'neon', wallpaper: 'ocean' })).toEqual({
      theme: DEFAULT_APPEARANCE.theme,
      wallpaper: 'ocean',
      textSize: 'default',
    });
    expect(toAppearance('junk')).toEqual(DEFAULT_APPEARANCE);
  });

  it('keeps a known text size and drops anything else', () => {
    expect(toAppearance({ textSize: 'xlarge' }).textSize).toBe('xlarge');
    expect(toAppearance({ textSize: 'huge' }).textSize).toBe('default');
  });
});
