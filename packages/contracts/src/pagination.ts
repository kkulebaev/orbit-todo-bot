/**
 * Server-side page size for /v1/tasks (and the bot/CLI rendering layer).
 * Kept in the contracts package so all three clients (api, bot, cli) agree
 * on the wire-level pagination boundary without duplicating the constant.
 */
export const PAGE_SIZE = 8;
