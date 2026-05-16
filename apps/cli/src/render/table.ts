/**
 * Hand-rolled column padding for table output.
 *
 * Computes max column widths from headers + rows, then prints each row with
 * cells separated by two spaces. Plain text only — no ANSI, no fancy box
 * drawing. Predictable and parseable.
 */
export function renderTable(opts: {
  headers: string[];
  rows: string[][];
}): string {
  const { headers, rows } = opts;
  const widths: number[] = headers.map((h) => displayWidth(h));
  for (const row of rows) {
    for (let i = 0; i < row.length; i++) {
      const w = displayWidth(row[i] ?? '');
      if (w > (widths[i] ?? 0)) widths[i] = w;
    }
  }
  const lines: string[] = [];
  lines.push(formatRow(headers, widths));
  lines.push(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of rows) {
    lines.push(formatRow(row, widths));
  }
  return lines.join('\n');
}

function formatRow(cells: string[], widths: number[]): string {
  return cells
    .map((c, i) => padEndDisplay(c ?? '', widths[i] ?? 0))
    .join('  ')
    .trimEnd();
}

/**
 * Width counting that treats a Cyrillic-or-ASCII character as 1 column.
 * We don't try to handle CJK double-width here — tasks are in russian.
 * Emoji are roughly 2 cols in most terminals, but counting them as 1 keeps
 * the math simple; the cosmetic mis-alignment on emoji rows is acceptable.
 */
function displayWidth(s: string): number {
  // Use Array.from to count code points (handles surrogate pairs for emoji).
  return Array.from(s).length;
}

function padEndDisplay(s: string, width: number): string {
  const w = displayWidth(s);
  if (w >= width) return s;
  return s + ' '.repeat(width - w);
}
