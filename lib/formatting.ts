import { splitLinks } from './links';
import { matchRanges } from './search';
import { isLocation, LOCATION_LABEL } from './location';

/**
 * WhatsApp-style formatting: *bold*, _italic_, ~strike~, `code` and
 * ```blocks```. Pure rendering of the decrypted text on this device --
 * nothing about it travels or is stored, and a phone without this code just
 * shows the asterisks.
 *
 * The text becomes a flat list of runs, each a slice of the original with the
 * styles that apply to it. The markers themselves are dropped. Links and
 * search hits are laid over the same runs, so a bold link or a highlighted
 * word in italics both work, and every run keeps its offset into the original
 * text -- which is what search matches against.
 */
export type FormattedRun = {
  text: string;
  /** Where this run starts in the original text. */
  start: number;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
  href?: string;
  /** Part of a search hit. */
  match?: boolean;
};

type Style = 'bold' | 'italic' | 'strike';
const MARKERS: Record<string, Style> = { '*': 'bold', _: 'italic', '~': 'strike' };

/** A slice that must be kept whole: a link, or code with its backticks. */
type Atom = { start: number; end: number; href?: string; inner?: [number, number] };

// Code is literal: inside it there is no formatting and no links. Blocks may
// span lines; inline code may not.
const CODE = /```([\s\S]+?)```|`([^`\n]+)`/g;
const WORDLIKE = /[\p{L}\p{N}]/u;

export function formatText(text: string, search = ''): FormattedRun[] {
  const atoms = findAtoms(text);
  const runs: FormattedRun[] = [];
  parse(text, 0, text.length, {}, atoms, runs);
  return highlight(runs, matchRanges(text, search));
}

/**
 * The text as it reads with the markers removed, for one-line previews. A
 * shared location reads as "Location", never as its raw coordinates.
 */
export function plainText(text: string): string {
  if (isLocation(text)) return LOCATION_LABEL;
  return formatText(text)
    .map((run) => run.text)
    .join('');
}

function findAtoms(text: string): Atom[] {
  const atoms: Atom[] = [];
  for (const match of text.matchAll(CODE)) {
    const fence = match[1] !== undefined ? 3 : 1;
    const start = match.index;
    const end = start + match[0].length;
    // Whitespace alone between the backticks is not code worth a box.
    if (!text.slice(start + fence, end - fence).trim()) continue;
    atoms.push({ start, end, inner: [start + fence, end - fence] });
  }

  let at = 0;
  for (const run of splitLinks(text)) {
    const end = at + run.text.length;
    // A link is dropped if it would cut into code.
    if (run.href && !atoms.some((atom) => atom.inner && at < atom.end && end > atom.start)) {
      atoms.push({ start: at, end, href: run.href });
    }
    at = end;
  }
  return atoms.sort((a, b) => a.start - b.start);
}

// Which atom covers each position, built once per message: atomAt is asked
// for every character, and a scan of every link and code span each time made
// a message full of them slow to draw. Atoms never overlap (code is found in
// one pass, and links that would cut into code are dropped), so one slot each.
const covers = new WeakMap<Atom[], Int32Array>();

function atomAt(atoms: Atom[], index: number): Atom | undefined {
  if (atoms.length === 0) return undefined;
  let cover = covers.get(atoms);
  if (!cover) {
    cover = new Int32Array(Math.max(...atoms.map((atom) => atom.end))).fill(-1);
    atoms.forEach((atom, slot) => cover!.fill(slot, atom.start, atom.end));
    covers.set(atoms, cover);
  }
  const slot = index < cover.length ? cover[index] : -1;
  return slot === -1 ? undefined : atoms[slot];
}

/**
 * An opening marker sits at the start of a word ("*hi" but not "2*3"), and its
 * closing partner at the end of one ("hi*" but not "snake_case"), on the same
 * line. Neither may be inside a link or code.
 *
 * `dead` remembers, per marker, where a search that found nothing stopped.
 * A later opener of that marker before that point searches part of the same
 * stretch, so it would find nothing either. Without this, thousands of
 * unclosed "*x " each rescan to the end of the line.
 */
function closerFor(
  text: string,
  open: number,
  to: number,
  atoms: Atom[],
  dead: Record<string, number>,
): number {
  const marker = text[open];
  const before = text[open - 1];
  const after = text[open + 1];
  if (before !== undefined && (WORDLIKE.test(before) || before === marker)) return -1;
  if (after === undefined || /\s/.test(after) || after === marker) return -1;
  if (open < (dead[marker] ?? -1)) return -1;

  for (let at = open + 2; at < to; at++) {
    const atom = atomAt(atoms, at);
    if (atom) {
      at = atom.end - 1;
      continue;
    }
    if (text[at] === '\n') {
      dead[marker] = at;
      return -1;
    }
    if (text[at] !== marker) continue;
    const inside = text[at - 1];
    const next = text[at + 1];
    if (/\s/.test(inside) || inside === marker) continue;
    if (next !== undefined && (WORDLIKE.test(next) || next === marker)) continue;
    return at;
  }
  dead[marker] = to;
  return -1;
}

function parse(
  text: string,
  from: number,
  to: number,
  styles: Partial<Record<Style, true>>,
  atoms: Atom[],
  runs: FormattedRun[],
) {
  let plainFrom = from;
  const dead: Record<string, number> = {};
  const flush = (until: number) => {
    emit(text, plainFrom, until, styles, atoms, runs);
  };

  for (let at = from; at < to; at++) {
    const atom = atomAt(atoms, at);
    if (atom) {
      at = atom.end - 1;
      continue;
    }
    const style = MARKERS[text[at]];
    if (!style || styles[style]) continue;
    const close = closerFor(text, at, to, atoms, dead);
    if (close === -1) continue;

    flush(at);
    parse(text, at + 1, close, { ...styles, [style]: true }, atoms, runs);
    plainFrom = close + 1;
    at = close;
  }
  flush(to);
}

/** One stretch with no markers in it, split around any links and code. */
function emit(
  text: string,
  from: number,
  to: number,
  styles: Partial<Record<Style, true>>,
  atoms: Atom[],
  runs: FormattedRun[],
) {
  let at = from;
  const push = (start: number, end: number, extra: Partial<FormattedRun> = {}) => {
    if (end > start) runs.push({ text: text.slice(start, end), start, ...styles, ...extra });
  };
  for (const atom of atoms) {
    if (atom.end <= at || atom.start >= to) continue;
    push(at, atom.start);
    if (atom.inner) push(atom.inner[0], atom.inner[1], { code: true });
    else push(atom.start, atom.end, { href: atom.href });
    at = atom.end;
  }
  push(at, to);
}

/** Cuts runs at the edges of search hits and marks the pieces inside. */
function highlight(runs: FormattedRun[], ranges: [number, number][]): FormattedRun[] {
  if (!ranges.length) return runs;
  const out: FormattedRun[] = [];
  // Runs and hits both go left to right and hits never overlap, so one pass
  // over each does it -- a message full of hits stays linear.
  let next = 0;
  for (const run of runs) {
    const end = run.start + run.text.length;
    let at = run.start;
    const piece = (from: number, to: number, match: boolean) => {
      if (to > from) {
        out.push({
          ...run,
          start: from,
          text: run.text.slice(from - run.start, to - run.start),
          ...(match ? { match: true } : {}),
        });
      }
    };
    while (next < ranges.length && ranges[next][1] <= run.start) next++;
    for (let index = next; index < ranges.length && ranges[index][0] < end; index++) {
      const from = Math.max(ranges[index][0], run.start);
      const to = Math.min(ranges[index][1], end);
      piece(at, from, false);
      piece(from, to, true);
      at = to;
    }
    piece(at, end, false);
  }
  return out;
}
