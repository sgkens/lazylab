// Builds the lazylab brand kit: SVG logos, PNG/WebP exports, the overview sheet and colour tokens,
// then copies the files the app and the docs use into src/assets/brand and docs/src/assets/brand.
//
// Shell: bash, brandkit/
//   bun install && bun run setup   # once: fonts, opentype.js, Playwright Chromium
//   bun run build
//
// All text is converted to outlines with opentype.js, so the SVGs render the same without the fonts
// installed (GitLab README previews, image viewers). Raster files are rendered by headless Chromium.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import opentype from 'opentype.js';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const out = (...p) => path.join(here, ...p);

// ---- palette -------------------------------------------------------------------------------

export const COLOURS = [
  { name: 'Ember 400', token: 'ember-400', hex: '#fb923c', use: 'Gradient start, accent on dark' },
  { name: 'Ember 600', token: 'ember-600', hex: '#ea580c', use: 'Gradient end, fills behind white icons (3.6:1: not for small text)' },
  { name: 'Ember 700', token: 'ember-700', hex: '#c2410c', use: 'Accent and links on light (5.2:1 on white)' },
  { name: 'Ink 950', token: 'ink-950', hex: '#09090b', use: 'App and docs background (dark)' },
  { name: 'Ink 900', token: 'ink-900', hex: '#18181b', use: 'Surfaces, wordmark on light' },
  { name: 'Ink 800', token: 'ink-800', hex: '#27272a', use: 'Borders on dark' },
  { name: 'Ash 400', token: 'ash-400', hex: '#a1a1aa', use: 'Muted text on dark' },
  { name: 'Paper', token: 'paper', hex: '#fafafa', use: 'Background (light), wordmark on dark' },
  { name: 'Pass', token: 'pass', hex: '#34d399', use: 'Pipeline passed' },
  { name: 'Fail', token: 'fail', hex: '#fb7185', use: 'Pipeline failed' },
  { name: 'Wait', token: 'wait', hex: '#fbbf24', use: 'Running, needs attention' }
];
const C = Object.fromEntries(COLOURS.map((c) => [c.token, c.hex]));

// ---- fonts and text outlines -----------------------------------------------------------------

const font = (pkg, file) => {
  const buf = readFileSync(path.join(here, 'node_modules', '@fontsource', pkg, 'files', file));
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
};
const F = {
  display: font('plus-jakarta-sans', 'plus-jakarta-sans-latin-800-normal.woff'),
  bold: font('plus-jakarta-sans', 'plus-jakarta-sans-latin-700-normal.woff'),
  body: font('plus-jakarta-sans', 'plus-jakarta-sans-latin-500-normal.woff'),
  mono: font('jetbrains-mono', 'jetbrains-mono-latin-500-normal.woff')
};

/** Text as one SVG path. `tracking` is in em. Returns the path data, advance width and ink box. */
function outline(f, text, { x = 0, y = 0, size, tracking = 0 }) {
  const scale = size / f.unitsPerEm;
  const glyphs = f.stringToGlyphs(text);
  let cx = x;
  const parts = [];
  const box = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity };
  glyphs.forEach((g, i) => {
    const p = g.getPath(cx, y, size);
    parts.push(p.toPathData(2));
    const b = p.getBoundingBox();
    if (b.x1 < b.x2) Object.assign(box, { x1: Math.min(box.x1, b.x1), y1: Math.min(box.y1, b.y1), x2: Math.max(box.x2, b.x2), y2: Math.max(box.y2, b.y2) });
    cx += g.advanceWidth * scale + (i < glyphs.length - 1 ? tracking * size + f.getKerningValue(g, glyphs[i + 1]) * scale : 0);
  });
  return { d: parts.join(''), width: cx - x, box };
}

const text = (f, s, o, fill, extra = '') => `<path d="${outline(f, s, o).d}" fill="${fill}"${extra}/>`;

// ---- the mark ---------------------------------------------------------------------------------
// A flask ("lab") with a sleeping "zz" ("lazy"): lazylab watches pipelines so you do not have to.
// Drawn on a 64 grid. The flask sits slightly left of centre to balance the zz.

const FLASK = 'M25.5 13V27.5L14.7 45.2A4 4 0 0 0 18.1 51.2H42.9A4 4 0 0 0 46.3 45.2L35.5 27.5V13';
const LIQUID = 'M8 40.5Q14 37.5 20 40.5T32 40.5T44 40.5T56 40.5V60H8Z';
const Z_BIG = 'M43 17.5H49L43 23.5H49';
const Z_SMALL = 'M51 8H55L51 12H55';

/**
 * @param {object} o
 * @param {'gradient'|'flat'|'none'} o.tile  background tile
 * @param {string} o.ink   colour of the flask and zz
 * @param {boolean} o.small  one z only, for favicons
 * @param {number} o.rx    tile corner radius (0 for full-bleed app icons)
 * @param {string} o.id    unique prefix for gradient and clip ids
 */
function markBody({ tile = 'gradient', ink = '#fff', small = false, rx = 15, id = 'll' }) {
  const defs = [
    `<clipPath id="${id}-flask"><path d="${FLASK}Z"/></clipPath>`,
    tile === 'gradient'
      ? `<linearGradient id="${id}-tile" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C['ember-400']}"/><stop offset="1" stop-color="${C['ember-600']}"/></linearGradient>`
      : ''
  ].join('');
  const tileEl =
    tile === 'none' ? '' : `<rect width="64" height="64" rx="${rx}" fill="${tile === 'gradient' ? `url(#${id}-tile)` : C['ember-600']}"/>`;
  const stroke = `fill="none" stroke="${ink}" stroke-linecap="round" stroke-linejoin="round"`;
  return [
    `<defs>${defs}</defs>`,
    tileEl,
    `<path d="${LIQUID}" fill="${ink}" clip-path="url(#${id}-flask)"/>`,
    `<path d="${FLASK}M22 13H39" ${stroke} stroke-width="4"/>`,
    `<path d="${Z_BIG}" ${stroke} stroke-width="2.6"/>`,
    small ? '' : `<path d="${Z_SMALL}" ${stroke} stroke-width="2" stroke-opacity=".8"/>`
  ].join('');
}

const svg = (w, h, body, title) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${title}"><title>${title}</title>${body}</svg>\n`;

const mark = (o = {}) => svg(64, 64, markBody(o), 'lazylab');

// ---- lockup: mark + wordmark ---------------------------------------------------------------

/** The horizontal logo on a 64-high grid. Returns body markup and width. */
function lockupBody(wordColour, id) {
  const size = 40;
  const probe = outline(F.display, 'lazylab', { size, tracking: -0.02 });
  // Centre the ascender-to-baseline band (the "l" and "b" stems) on the mark.
  const baseline = 32 + -probe.box.y1 / 2;
  const word = outline(F.display, 'lazylab', { x: 80, y: baseline, size, tracking: -0.02 });
  return { body: `${markBody({ id })}<path d="${word.d}" fill="${wordColour}"/>`, width: Math.ceil(80 + word.width + 2) };
}

const lockup = (wordColour, id) => {
  const { body, width } = lockupBody(wordColour, id);
  return svg(width, 64, body, 'lazylab');
};

// ---- social preview (1280 x 640) -------------------------------------------------------------

function social() {
  const w = 1280;
  const h = 640;
  const { body, width } = lockupBody(C.paper, 'soc');
  const scale = 2.5;
  const x = (w - width * scale) / 2;
  const tagline = 'A self-hosted GitLab workspace for developers and their agents.';
  const tag = outline(F.body, tagline, { size: 34 });
  const features = 'inbox  ·  watches  ·  CI triage  ·  vault  ·  lazy CLI  ·  MCP';
  const feat = outline(F.mono, features, { size: 22 });
  return svg(
    w,
    h,
    [
      `<defs><radialGradient id="glow" cx=".5" cy=".38" r=".6"><stop offset="0" stop-color="${C['ember-600']}" stop-opacity=".22"/><stop offset="1" stop-color="${C['ember-600']}" stop-opacity="0"/></radialGradient>`,
      `<pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="${C['ink-900']}" stroke-width="1"/></pattern>`,
      `<linearGradient id="bar" x1="0" x2="1"><stop offset="0" stop-color="${C['ember-400']}"/><stop offset="1" stop-color="${C['ember-600']}"/></linearGradient></defs>`,
      `<rect width="${w}" height="${h}" fill="${C['ink-950']}"/>`,
      `<rect width="${w}" height="${h}" fill="url(#grid)"/>`,
      `<rect width="${w}" height="${h}" fill="url(#glow)"/>`,
      `<g transform="translate(${x.toFixed(1)} 168) scale(${scale})">${body}</g>`,
      text(F.body, tagline, { x: (w - tag.width) / 2, y: 410, size: 34 }, '#e4e4e7'),
      text(F.mono, features, { x: (w - feat.width) / 2, y: 470, size: 22 }, C['ash-400']),
      `<rect y="${h - 8}" width="${w}" height="8" fill="url(#bar)"/>`
    ].join(''),
    'lazylab: a self-hosted GitLab workspace for developers and their agents'
  );
}

// ---- overview sheet ----------------------------------------------------------------------------

function sheet() {
  const w = 1440;
  const parts = [];
  const label = (s, x, y, fill = C['ash-400']) => parts.push(text(F.bold, s.toUpperCase(), { x, y, size: 13, tracking: 0.08 }, fill));
  const panel = (x, y, pw, ph, fill, stroke = C['ink-800']) =>
    parts.push(`<rect x="${x}" y="${y}" width="${pw}" height="${ph}" rx="16" fill="${fill}" stroke="${stroke}"/>`);
  const place = (body, x, y, s = 1) => parts.push(`<g transform="translate(${x} ${y}) scale(${s})">${body}</g>`);

  // Header
  place(markBody({ id: 'hd' }), 64, 56, 0.75);
  parts.push(text(F.display, 'lazylab', { x: 124, y: 92, size: 30, tracking: -0.02 }, C.paper));
  parts.push(text(F.body, 'Brand kit', { x: 250, y: 92, size: 30 }, C['ash-400']));
  parts.push(text(F.mono, 'flask = lab · zz = lazy: it watches the pipeline so you do not have to', { x: 64, y: 140, size: 15 }, C['ash-400']));

  // Row 1: primary mark and lockups
  label('Primary mark', 64, 196);
  panel(64, 212, 360, 260, C['ink-900']);
  place(markBody({ id: 'r1' }), 164, 262, 2.5);
  const light = lockupBody(C['ink-900'], 'r1l');
  const dark = lockupBody(C.paper, 'r1d');
  label('Logo on light', 448, 196);
  panel(448, 212, 452, 260, '#ffffff', '#e4e4e7');
  place(light.body, 448 + (452 - light.width * 1.4) / 2, 297, 1.4);
  label('Logo on dark', 924, 196);
  panel(924, 212, 452, 260, C['ink-950']);
  place(dark.body, 924 + (452 - dark.width * 1.4) / 2, 297, 1.4);

  // Row 2: one-colour marks and sizes
  label('One colour', 64, 528);
  panel(64, 544, 200, 180, C.paper, '#e4e4e7');
  place(markBody({ tile: 'none', ink: C['ink-900'], id: 'm1' }), 116, 586, 1.5);
  panel(280, 544, 200, 180, C['ember-600'], C['ember-600']);
  place(markBody({ tile: 'none', ink: '#fff', id: 'm2' }), 332, 586, 1.5);
  panel(496, 544, 200, 180, C['ink-950']);
  place(markBody({ tile: 'none', ink: C.paper, id: 'm3' }), 548, 586, 1.5);
  label('Sizes  ·  minimum 16 px  ·  favicon drops the small z below 32 px', 720, 528);
  panel(720, 544, 656, 180, C['ink-900']);
  let sx = 760;
  for (const s of [16, 24, 32, 48, 64, 96]) {
    place(markBody({ id: `sz${s}`, small: s < 32 }), sx, 680 - s, s / 64);
    parts.push(text(F.mono, `${s}`, { x: sx, y: 706, size: 12 }, C['ash-400']));
    sx += s + 44;
  }

  // Row 3: colours
  label('Colour', 64, 780);
  // Six columns spanning the same 1312 px as the panels above, 16 px apart.
  const sw = (1312 - 5 * 16) / 6;
  COLOURS.forEach((c, i) => {
    const cx = +(64 + (i % 6) * (sw + 16)).toFixed(1);
    const cy = 796 + Math.floor(i / 6) * 140;
    parts.push(`<rect x="${cx}" y="${cy}" width="${sw}" height="124" rx="12" fill="${C['ink-900']}" stroke="${C['ink-800']}"/>`);
    parts.push(`<rect x="${cx + 12}" y="${cy + 12}" width="${sw - 24}" height="56" rx="8" fill="${c.hex}" stroke="${C['ink-800']}"/>`);
    parts.push(text(F.bold, c.name, { x: cx + 14, y: cy + 92, size: 14 }, C.paper));
    parts.push(text(F.mono, c.hex, { x: cx + 14, y: cy + 112, size: 13 }, C['ash-400']));
  });

  // Row 4: type
  const ty = 1100;
  label('Type', 64, ty);
  panel(64, ty + 16, 644, 170, C['ink-900']);
  parts.push(text(F.display, 'Aa  lazylab', { x: 96, y: ty + 96, size: 52, tracking: -0.02 }, C.paper));
  parts.push(text(F.body, 'Plus Jakarta Sans 500-800 · UI, headings, wordmark', { x: 96, y: ty + 146, size: 16 }, C['ash-400']));
  panel(732, ty + 16, 644, 170, C['ink-900']);
  parts.push(text(F.mono, '$ lazy push --detach', { x: 764, y: ty + 90, size: 30 }, C['ember-400']));
  parts.push(text(F.body, 'JetBrains Mono 400-600 · code, CLI, ids, hashes', { x: 764, y: ty + 146, size: 16 }, C['ash-400']));

  const h = ty + 250;
  return svg(w, h, `<rect width="${w}" height="${h}" fill="${C['ink-950']}"/>${parts.join('')}`, 'lazylab brand kit');
}

// ---- tokens -------------------------------------------------------------------------------

const tokensCss = () =>
  `/* lazylab colour tokens. Generated by brandkit/build.mjs; edit COLOURS there. */\n:root {\n${COLOURS.map((c) => `  --ll-${c.token}: ${c.hex};`).join('\n')}\n  --ll-font-sans: 'Plus Jakarta Sans', system-ui, sans-serif;\n  --ll-font-mono: 'JetBrains Mono', ui-monospace, monospace;\n}\n`;

// ---- write ---------------------------------------------------------------------------------

const files = {
  'svg/lazylab-mark.svg': mark(),
  'svg/lazylab-mark-flat.svg': mark({ tile: 'flat' }),
  'svg/lazylab-mark-ink.svg': mark({ tile: 'none', ink: C['ink-900'] }),
  'svg/lazylab-mark-white.svg': mark({ tile: 'none', ink: '#ffffff' }),
  'svg/lazylab-logo-light.svg': lockup(C['ink-900'], 'lgl'),
  'svg/lazylab-logo-dark.svg': lockup(C.paper, 'lgd'),
  'svg/favicon.svg': mark({ small: true }),
  'svg/lazylab-social.svg': social(),
  'brandkit.svg': sheet(),
  'tokens.css': tokensCss()
};
for (const [rel, content] of Object.entries(files)) {
  mkdirSync(path.dirname(out(rel)), { recursive: true });
  writeFileSync(out(rel), content);
}

// Raster exports: [source svg, output, width, height, background or null for transparent]
const rasters = [
  ['svg/favicon.svg', 'png/favicon-32.png', 32, 32],
  ['svg/lazylab-mark.svg', 'png/lazylab-mark-192.png', 192, 192],
  ['svg/lazylab-mark.svg', 'png/lazylab-mark-512.png', 512, 512],
  ['svg/lazylab-mark.svg', 'webp/lazylab-mark-512.webp', 512, 512],
  ['svg/lazylab-logo-light.svg', 'webp/lazylab-logo-light.webp', null, 192],
  ['svg/lazylab-logo-dark.svg', 'webp/lazylab-logo-dark.webp', null, 192],
  ['svg/lazylab-social.svg', 'png/lazylab-social.png', 1280, 640],
  ['svg/lazylab-social.svg', 'webp/lazylab-social.webp', 1280, 640],
  ['brandkit.svg', 'webp/brandkit.webp', 1440, null]
];
// iOS rounds and masks the icon itself, so the touch icon is full bleed.
writeFileSync(out('svg/apple-touch-icon.svg'), mark({ rx: 0 }));
rasters.push(['svg/apple-touch-icon.svg', 'png/apple-touch-icon.png', 180, 180]);

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [src, dest, w0, h0] of rasters) {
  const data = readFileSync(out(src), 'utf8');
  const [, vw, vh] = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(data).map(Number);
  const w = Math.round(w0 ?? (h0 * vw) / vh);
  const h = Math.round(h0 ?? (w0 * vh) / vw);
  mkdirSync(path.dirname(out(dest)), { recursive: true });
  if (dest.endsWith('.png')) {
    // Screenshots compress PNG about twice as well as canvas.toDataURL.
    await page.setViewportSize({ width: w, height: h });
    const uri = 'data:image/svg+xml;base64,' + Buffer.from(data).toString('base64');
    await page.setContent(`<style>body{margin:0}img{display:block}</style><img src="${uri}" width="${w}" height="${h}">`);
    await page.locator('img').evaluate((img) => img.decode());
    await page.screenshot({ path: out(dest), omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } });
    continue;
  }
  const type = 'image/webp';
  const b64 = await page.evaluate(
    async ({ data, w, h, type }) => {
      const img = new Image();
      img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(data)));
      await img.decode();
      const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      return canvas.toDataURL(type, 0.95).split(',')[1];
    },
    { data, w, h, type }
  );
  writeFileSync(out(dest), Buffer.from(b64, 'base64'));
}
await browser.close();

// Copies used by the app and the docs site.
const copies = {
  'src/assets/brand': ['svg/lazylab-mark.svg', 'svg/favicon.svg', 'png/apple-touch-icon.png'],
  'docs/src/assets/brand': ['svg/lazylab-mark.svg', 'svg/favicon.svg', 'png/apple-touch-icon.png', 'png/lazylab-social.png']
};
for (const [dir, list] of Object.entries(copies)) {
  mkdirSync(path.join(repo, dir), { recursive: true });
  for (const rel of list) copyFileSync(out(rel), path.join(repo, dir, path.basename(rel)));
}

console.log(`Wrote ${Object.keys(files).length} vector files, ${rasters.length} raster files, copies in ${Object.keys(copies).join(', ')}`);
