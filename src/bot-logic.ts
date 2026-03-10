export type AddCommandParse = { kind: 'self'; title: string };

/**
 * Parses `/add` command text (without the leading `/add`).
 */
export function parseAddCommandText(raw: string): AddCommandParse | null {
  const text = raw.trim();
  if (!text) return null;

  // Assignment to other users is disabled.
  // Treat everything as the task title.
  return { kind: 'self', title: text };
}

export function clipTitle(raw: string, max = 200) {
  return raw.trim().slice(0, max);
}
