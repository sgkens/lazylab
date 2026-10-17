/**
 * Terminal output for `lazy`. Colours live in Palette and structural symbols in UI; layout is
 * computed on plain text and colour is applied last, so ANSI codes never break column widths.
 */

const colour = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR && process.env.TERM !== 'dumb';

export const Palette = {
  ok: '32',
  fail: '31',
  warn: '33',
  info: '36',
  dim: '2',
  bold: '1'
} as const;

export type Tone = keyof typeof Palette;

export const UI = {
  mark: '■',
  arrow: '▶',
  item: '◆',
  sep: '·',
  rule: '─'
} as const;

export function paint(tone: Tone | undefined, text: string): string {
  return colour && tone ? `\x1b[${Palette[tone]}m${text}\x1b[0m` : text;
}

/** Pads or truncates plain text to `width` columns. Call before paint(). */
export function fit(text: string, width: number): string {
  if (width <= 0) return '';
  if (text.length > width) return width === 1 ? '…' : `${text.slice(0, width - 1)}…`;
  return text.padEnd(width);
}

export interface Cell {
  text: string;
  tone?: Tone;
  /** Takes the remaining width and is truncated to it. At most one per row. */
  flex?: boolean;
}

/** Prints rows as aligned columns. Widths come from the plain text of every row. */
export function table(rows: Cell[][], gap = 2): string[] {
  if (rows.length === 0) return [];
  const columns = Math.max(...rows.map((r) => r.length));
  const widths = Array.from({ length: columns }, (_, c) => Math.max(...rows.map((r) => r[c]?.text.length ?? 0)));
  const total = process.stdout.columns || 120;
  const flexCol = rows[0].findIndex((c) => c.flex);
  if (flexCol >= 0) {
    const fixed = widths.reduce((sum, w, c) => (c === flexCol ? sum : sum + w), 0) + gap * (columns - 1);
    widths[flexCol] = Math.max(10, Math.min(widths[flexCol], total - fixed));
  }
  return rows.map((row) =>
    row
      .map((cell, c) => {
        const last = c === row.length - 1;
        const text = last && !cell.flex ? cell.text : fit(cell.text, widths[c]);
        return paint(cell.tone, last ? text.trimEnd() : text);
      })
      .join(' '.repeat(gap))
  );
}

const STATUS_TONE: Record<string, Tone> = {
  success: 'ok',
  passed: 'ok',
  merged: 'ok',
  failed: 'fail',
  canceled: 'warn',
  skipped: 'dim',
  manual: 'warn',
  running: 'info',
  pending: 'info',
  created: 'dim',
  preparing: 'info',
  waiting_for_resource: 'info',
  scheduled: 'dim'
};

export const toneFor = (status: string): Tone | undefined => STATUS_TONE[status];

export function statusCell(status: string): Cell {
  return { text: `${UI.mark} ${status}`, tone: toneFor(status) };
}

export function relativeTime(iso: string | undefined, now = Date.now()): string {
  if (!iso) return '';
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

export function duration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '';
  const s = Math.round(seconds);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

export const out = (line = '') => process.stdout.write(`${line}\n`);
export const err = (line = '') => process.stderr.write(`${line}\n`);

/** Clears colour state before reporting a crash, so the terminal is not left painted. */
export function resetTerminal() {
  if (colour) process.stdout.write('\x1b[0m');
}
