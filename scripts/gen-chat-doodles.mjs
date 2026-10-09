// Generates public/chat-doodles.svg: a seamless tile of scattered, rotated doodles,
// plus one copy per tinted wallpaper (chat-doodles-ocean.svg, ...) with the accent
// ink in that wallpaper's hue. Same layout in every tile; only the ink changes.
// Run: node scripts/gen-chat-doodles.mjs   (change seed for a different scatter)
import { writeFileSync } from 'node:fs';

const TEAL = { stroke: '#00cfc1', opacity: 0.13 };
const GREY = { stroke: '#8a9a9d', opacity: 0.11 };

// Accent inks for the tinted wallpapers (app/globals.css mixes the same hues
// into the background). A touch stronger than teal on the void, because the
// doodles sit on a background of their own hue.
const TINTS = {
  ocean: { stroke: '#2f7fd8', opacity: 0.2 },
  forest: { stroke: '#2e9b5f', opacity: 0.2 },
  dusk: { stroke: '#8a5cd6', opacity: 0.2 },
  sand: { stroke: '#b5832f', opacity: 0.22 },
};

// Each doodle: body drawn in original coordinates, plus its centre.
const doodles = [
  { id: 'bubble', c: [38, 42], ink: TEAL, body: `<path d="M20 22h36a8 8 0 0 1 8 8v16a8 8 0 0 1-8 8H36l-10 8v-8h-6a8 8 0 0 1-8-8V30a8 8 0 0 1 8-8z"/><path d="M28 38h.01M38 38h.01M48 38h.01" stroke-width="4"/>` },
  { id: 'bolt', c: [149, 35], ink: TEAL, body: `<path d="M150 14l-14 22h12l-6 20 18-26h-12l8-16z"/>` },
  { id: 'heart', c: [262, 34], ink: TEAL, body: `<path d="M262 46c-10-7-16-12-16-19a8 8 0 0 1 16-2 8 8 0 0 1 16 2c0 7-6 12-16 19z"/>` },
  { id: 'lock', c: [98, 111], ink: TEAL, body: `<path d="M88 108v-8a10 10 0 0 1 20 0v8"/><rect x="82" y="108" width="32" height="24" rx="5"/><path d="M98 117v6"/>` },
  { id: 'sparkle', c: [214, 112], ink: TEAL, body: `<path d="M214 98l4 10 10 4-10 4-4 10-4-10-10-4 10-4z"/>` },
  { id: 'note', c: [31, 177], ink: TEAL, body: `<path d="M24 190v-26l20-5v26"/><circle cx="19" cy="191" r="5"/><circle cx="39" cy="186" r="5"/>` },
  { id: 'plane', c: [170, 172], ink: TEAL, body: `<path d="M150 168l40-16-14 40-8-16-18-8z"/><path d="M168 176l8-8"/>` },
  { id: 'ticks', c: [262, 182], ink: TEAL, body: `<path d="M250 182l7 7 13-14M262 189l13-14"/>` },
  { id: 'chip', c: [105, 264], ink: TEAL, body: `<path d="M92 250h26a6 6 0 0 1 6 6v10a6 6 0 0 1-6 6h-4l-6 6v-6H92a6 6 0 0 1-6-6v-10a6 6 0 0 1 6-6z"/>` },
  { id: 'moon', c: [234, 266], ink: TEAL, body: `<path d="M226 252a16 16 0 1 0 18 22 13 13 0 0 1-18-22z"/>` },
  { id: 'smiley', c: [104, 36], ink: GREY, body: `<circle cx="104" cy="36" r="13"/><path d="M98 40s2 4 6 4 6-4 6-4M99 32h.01M109 32h.01"/>` },
  { id: 'camera', c: [207, 42], ink: GREY, body: `<path d="M190 32h8l3-5h12l3 5h8a4 4 0 0 1 4 4v18a4 4 0 0 1-4 4h-34a4 4 0 0 1-4-4V36a4 4 0 0 1 4-4z"/><circle cx="207" cy="45" r="7"/>` },
  { id: 'coffee', c: [38, 103], ink: GREY, body: `<path d="M22 98h26v14a10 10 0 0 1-10 10h-6a10 10 0 0 1-10-10V98zM48 102h4a5 5 0 0 1 0 10h-4M28 90c0-3 3-3 3-6M36 90c0-3 3-3 3-6"/>` },
  { id: 'bell', c: [150, 113], ink: GREY, body: `<path d="M150 96a12 12 0 0 1 12 12v8l4 6h-32l4-6v-8a12 12 0 0 1 12-12zM146 126a4 4 0 0 0 8 0"/>` },
  { id: 'sun', c: [278, 114], ink: GREY, body: `<circle cx="278" cy="114" r="8"/><path d="M278 98v4M278 126v4M262 114h4M290 114h4M267 103l3 3M286 122l3 3M289 103l-3 3M270 122l-3 3"/>` },
  { id: 'mail', c: [101, 178], ink: GREY, body: `<rect x="84" y="166" width="34" height="24" rx="4"/><path d="M84 170l17 11 17-11"/>` },
  { id: 'planet', c: [37, 263], ink: GREY, body: `<circle cx="36" cy="262" r="10"/><path d="M20 268c-6 4-4 8 6 6 10-2 24-9 30-15 4-5 0-7-6-5"/>` },
  { id: 'leaf', c: [176, 265], ink: GREY, body: `<path d="M160 280c0-20 14-30 32-30 0 20-12 30-32 30zM160 280l20-20"/>` },
];
const STAR = `<path d="M0-6l2 4 4 2-4 2-2 4-2-4-4-2 4-2z"/>`;

// Deterministic PRNG so the tile is reproducible.
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const between = (a, b) => a + rand() * (b - a);

const TILE = 320;
const N = 6; // 6x6 staggered grid -> 36 doodles per tile
const step = TILE / N;

// Order doodles so neighbours differ: shuffle each pass of the set.
const pool = [];
while (pool.length < N * N) {
  const pass = [...doodles].sort(() => rand() - 0.5);
  if (pool.length && pass[0] === pool[pool.length - 1]) pass.push(pass.shift());
  pool.push(...pass);
}

const fmt = (n) => +n.toFixed(1);
const items = [];
let k = 0;
for (let row = 0; row < N; row++) {
  for (let col = 0; col < N; col++) {
    const d = pool[k++];
    // Odd rows shift half a cell: a staggered lattice, no straight columns.
    const x = (col + 0.5 + (row % 2) * 0.5) * step + between(-7, 7);
    const y = (row + 0.5) * step + between(-10, 10);
    const r = between(-38, 38);
    const s = between(0.78, 0.95);
    items.push({ d, x, y, r, s });
  }
}
// Tiny stars dropped only into real gaps (measured across the wrap), for texture.
const wrapDist = (ax, ay, bx, by) => {
  const dx = Math.min(Math.abs(ax - bx), TILE - Math.abs(ax - bx));
  const dy = Math.min(Math.abs(ay - by), TILE - Math.abs(ay - by));
  return Math.hypot(dx, dy);
};
const stars = [];
for (let tries = 0; tries < 4000 && stars.length < 16; tries++) {
  const x = between(0, TILE), y = between(0, TILE);
  const clearOfDoodles = items.every((it) => wrapDist(x, y, it.x, it.y) > 21 * it.s + 7);
  const clearOfStars = stars.every((st) => wrapDist(x, y, st.x, st.y) > 30);
  if (clearOfDoodles && clearOfStars) stars.push({ x, y, r: between(0, 45), s: between(0.7, 1.1) });
}

// Anything near an edge is drawn again on the opposite side so the tile wraps seamlessly.
const copies = (x, y, reach) => {
  const out = [];
  for (const dx of [-TILE, 0, TILE]) for (const dy of [-TILE, 0, TILE]) {
    const cx = x + dx, cy = y + dy;
    if (cx > -reach && cx < TILE + reach && cy > -reach && cy < TILE + reach) out.push([cx, cy]);
  }
  return out;
};

const uses = { teal: [], grey: [] };
for (const it of items) {
  const bucket = it.d.ink === TEAL ? uses.teal : uses.grey;
  for (const [x, y] of copies(it.x, it.y, 28)) {
    bucket.push(`<use href="#${it.d.id}" transform="translate(${fmt(x)} ${fmt(y)}) rotate(${fmt(it.r)}) scale(${fmt(it.s * 100) / 100})"/>`);
  }
}
const starUses = [];
for (const st of stars) {
  for (const [x, y] of copies(st.x, st.y, 8)) {
    starUses.push(`<use href="#star" transform="translate(${fmt(x)} ${fmt(y)}) rotate(${fmt(st.r)}) scale(${fmt(st.s * 100) / 100})"/>`);
  }
}

const defs = doodles
  .map((d) => `    <g id="${d.id}" transform="translate(${-d.c[0]} ${-d.c[1]})">${d.body}</g>`)
  .join('\n');

const tile = (accent) => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${TILE}" height="${TILE}" viewBox="0 0 ${TILE} ${TILE}" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2">
  <!-- Zing chat wallpaper: one repeating tile of line doodles, WhatsApp style.
       Generated: a staggered 6x6 lattice with each doodle jittered, tilted and
       resized, so nothing lines up in rows or columns. Doodles near an edge are
       repeated on the opposite edge, which keeps the tile seamless. Two faint
       inks (teal accent, grey) so it reads as texture behind the bubbles. -->
  <defs>
${defs}
    <g id="star">${STAR}</g>
  </defs>
  <g stroke="${accent.stroke}" stroke-opacity="${accent.opacity}">
    ${uses.teal.join('\n    ')}
  </g>
  <g stroke="${GREY.stroke}" stroke-opacity="${GREY.opacity}">
    ${uses.grey.join('\n    ')}
    ${starUses.join('\n    ')}
  </g>
</svg>
`;

const svg = tile(TEAL);
writeFileSync(new URL('../public/chat-doodles.svg', import.meta.url), svg);
for (const [name, ink] of Object.entries(TINTS)) {
  writeFileSync(new URL(`../public/chat-doodles-${name}.svg`, import.meta.url), tile(ink));
}
console.log('bytes', svg.length, 'doodles', items.length, 'stars', stars.length);
