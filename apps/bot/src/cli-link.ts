import { randomUUID } from 'node:crypto';
import type { Context } from 'grammy';
import type { ApiClient } from '@orbit/api-client';

/**
 * Handler for the /cli_link [label] command.
 *
 * Mints a per-user PAT via POST /v1/cli/tokens (bot-PAT, canImpersonate=true)
 * and replies with the plaintext token — shown once and only here.
 */
export async function handleCliLink(ctx: Context, api: ApiClient): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  const rawText = ctx.message?.text ?? '';
  const label =
    rawText.replace(/^\/cli[_-]link\s*/i, '').trim() || null;

  const idempotencyKey = randomUUID();

  try {
    const minted = await api
      .asViewer(String(from.id))
      .mintCliToken(
        {
          telegramUserId: String(from.id),
          label: label ?? undefined,
          ttlDays: 365,
        },
        idempotencyKey,
      );

    await ctx.reply(
      `🔑 Ваш CLI-токен (показывается один раз, скопируйте сейчас):\n\n` +
        `\`${minted.token}\`\n\n` +
        `Установите CLI и выполните:\n\n` +
        `\`orbit login --token <token> --base-url https://orbit-todo-api.up.railway.app\`\n\n` +
        `Отозвать токен: \`orbit tokens revoke ${minted.id}\` или /cli\\_revoke (TBD).`,
      { parse_mode: 'Markdown' },
    );
  } catch (e) {
    console.error('[api] /cli_link error', { err: String(e) });
    await ctx.reply('🛠 Не удалось создать токен, попробуйте ещё раз чуть позже.');
  }
}
