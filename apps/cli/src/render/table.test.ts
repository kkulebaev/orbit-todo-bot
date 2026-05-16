import { describe, expect, it } from 'vitest';

import { renderTable } from './table.js';

describe('renderTable', () => {
  it('pads columns to fit the widest cell', () => {
    const out = renderTable({
      headers: ['#', 'Title', 'Status'],
      rows: [
        ['1', 'short', 'open'],
        ['10', 'a longer title', 'done'],
      ],
    });
    const lines = out.split('\n');
    expect(lines).toHaveLength(4); // header + separator + 2 rows
    // Header is padded to widest column widths.
    expect(lines[0]).toContain('Title');
    // Second-column width must accommodate "a longer title" (14 chars).
    expect(lines[3]).toContain('a longer title');
    // Separator is dashes with the same two-space gap.
    expect(lines[1]).toMatch(/^-+ {2}-+ {2}-+$/);
  });

  it('handles a single-row table', () => {
    const out = renderTable({
      headers: ['A'],
      rows: [['x']],
    });
    expect(out.split('\n')).toHaveLength(3);
  });

  it('renders an empty rows array as just headers + separator', () => {
    const out = renderTable({ headers: ['A', 'B'], rows: [] });
    expect(out.split('\n')).toHaveLength(2);
  });
});
