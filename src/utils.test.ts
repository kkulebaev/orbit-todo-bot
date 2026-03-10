import { describe, expect, it } from 'vitest';
import { escapeHtml, fmtUser, kbList } from './utils.js';

describe('utils', () => {
  it('escapeHtml escapes <, > and &', () => {
    expect(escapeHtml('a & b < c > d')).toBe('a &amp; b &lt; c &gt; d');
  });

  it('fmtUser prefers username', () => {
    expect(fmtUser({ username: 'kk', firstName: 'Kostya' } as any)).toBe('@kk');
  });

  it('fmtUser falls back to firstName, then to "user"', () => {
    expect(fmtUser({ username: null, firstName: 'Kostya' } as any)).toBe('Kostya');
    expect(fmtUser({ username: null, firstName: null } as any)).toBe('user');
  });

  it('kbList renders pagination controls disabled on first page', () => {
    const kb = kbList('my', 0, [{ numId: 10, status: 'open' } as any], 1);
    const rows: any[] = (kb as any).inline_keyboard;

    // Find the row with prev/next controls: [ {text:'·'|⬅️}, {text:'·'|➡️} ]
    const row = rows.find((r: any[]) => r.length === 2 && ['·', '⬅️'].includes(r[0].text));
    expect(row[0].text).toBe('·');
    expect(row[0].callback_data).toBe('noop');
  });
});
