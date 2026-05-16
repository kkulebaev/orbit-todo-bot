/**
 * Session payload — opaque JSON string the bot stores in `SessionDto.payload`.
 *
 * The API treats this string as a black box. The bot is the sole
 * producer/consumer, so we can evolve the shape additively (AC-23): new
 * optional fields are safe to ship without coordinating with the API.
 * `decodePayload` therefore preserves unknown keys (forward-compat).
 */

import type { ListMode } from "./utils.js";

export type SessionPayload = {
  panelMode?: ListMode;
  panelPage?: number;
  panelMessageId?: number;
  promptMessageId?: number;
  draftTitle?: string;
  /** Stable display id for the linked task. Stored only on the bot side. */
  taskNumId?: number;
};

export function encodePayload(p: SessionPayload): string {
  return JSON.stringify(p);
}

export function decodePayload(s: string | null | undefined): SessionPayload {
  if (!s) return {};
  try {
    const v = JSON.parse(s) as unknown;
    if (v !== null && typeof v === "object") return v as SessionPayload;
    return {};
  } catch {
    return {};
  }
}
