export type AddCommandParse =
  | { kind: 'self'; title: string }
  | { kind: 'assign'; username: string; title: string };

/**
 * Parses `/add` command text (without the leading `/add`).
 *
 * Supported:
 * - "купить молоко" → self
 * - "@username купить молоко" → assign
 */
export function parseAddCommandText(raw: string): AddCommandParse | null {
  const text = raw.trim();
  if (!text) return null;

  const m = text.match(/^@([A-Za-z0-9_]{5,})\s+(.+)$/);
  if (m) {
    return {
      kind: 'assign',
      username: m[1],
      title: m[2].trim(),
    };
  }

  return { kind: 'self', title: text };
}

export function clipTitle(raw: string, max = 200) {
  return raw.trim().slice(0, max);
}
