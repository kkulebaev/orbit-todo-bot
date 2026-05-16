import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ApiClient, ApiViewerClient } from '@orbit/api-client';
import { handleCliLink } from './cli-link.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TG_USER_ID = '999888777';
const MINT_RESPONSE = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  token: 'orbit_pat_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  label: null,
  expiresAt: '2027-01-01T00:00:00.000Z',
};

/** Minimal Context-like object used by handleCliLink. */
function makeCtx(text: string, fromId = TG_USER_ID) {
  const replySpy = vi.fn().mockResolvedValue(undefined);
  return {
    from: { id: Number(fromId) },
    message: { text },
    reply: replySpy,
    chat: { type: 'private' },
  } as unknown as Parameters<typeof handleCliLink>[0] & { reply: typeof replySpy };
}

/** Build a mock ApiClient whose asViewer().mintCliToken resolves with `response`. */
function makeApi(mintResponse = MINT_RESPONSE): ApiClient & {
  viewerMock: Partial<ApiViewerClient>;
} {
  const mintSpy = vi.fn().mockResolvedValue(mintResponse);
  const viewerMock: Partial<ApiViewerClient> = { mintCliToken: mintSpy };
  const api = {
    asViewer: vi.fn().mockReturnValue(viewerMock),
    viewerMock,
  } as unknown as ApiClient & { viewerMock: Partial<ApiViewerClient> };
  return api;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('handleCliLink', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls mintCliToken with the user TG id from ctx.from.id', async () => {
    const ctx = makeCtx('/cli_link');
    const api = makeApi();

    await handleCliLink(ctx, api);

    expect(api.asViewer).toHaveBeenCalledWith(TG_USER_ID);
    const mintSpy = (api.viewerMock as { mintCliToken: ReturnType<typeof vi.fn> }).mintCliToken;
    expect(mintSpy).toHaveBeenCalledWith(
      expect.objectContaining({ telegramUserId: TG_USER_ID }),
      expect.any(String), // idempotency key (randomUUID)
    );
  });

  it('reply contains the plaintext token from mintCliToken response', async () => {
    const ctx = makeCtx('/cli_link');
    const api = makeApi();

    await handleCliLink(ctx, api);

    const replyText: string = ctx.reply.mock.calls[0][0] as string;
    expect(replyText).toContain(MINT_RESPONSE.token);
  });

  it('reply does not advertise the --base-url flag (default is built into the CLI)', async () => {
    const ctx = makeCtx('/cli_link');
    const api = makeApi();

    await handleCliLink(ctx, api);

    const replyText: string = ctx.reply.mock.calls[0][0] as string;
    expect(replyText).not.toContain('--base-url');
    expect(replyText).toContain('orbit login --token');
  });

  it('reply inlines the minted token into the orbit login command for one-tap copy', async () => {
    const ctx = makeCtx('/cli_link');
    const api = makeApi();

    await handleCliLink(ctx, api);

    const replyText: string = ctx.reply.mock.calls[0][0] as string;
    expect(replyText).toContain(`orbit login --token ${MINT_RESPONSE.token}`);
  });

  it('passes an optional label from the command text to mintCliToken', async () => {
    const ctx = makeCtx('/cli_link my laptop');
    const api = makeApi();

    await handleCliLink(ctx, api);

    const mintSpy = (api.viewerMock as { mintCliToken: ReturnType<typeof vi.fn> }).mintCliToken;
    expect(mintSpy).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'my laptop' }),
      expect.any(String),
    );
  });

  it('two separate calls each mint their own token (separate idempotency keys)', async () => {
    const ctx1 = makeCtx('/cli_link');
    const ctx2 = makeCtx('/cli_link');
    const api = makeApi();

    await handleCliLink(ctx1, api);
    await handleCliLink(ctx2, api);

    const mintSpy = (api.viewerMock as { mintCliToken: ReturnType<typeof vi.fn> }).mintCliToken;
    expect(mintSpy).toHaveBeenCalledTimes(2);
    // Each call gets its own idempotency key (randomUUID per invocation)
    const key1: string = mintSpy.mock.calls[0][1] as string;
    const key2: string = mintSpy.mock.calls[1][1] as string;
    expect(key1).not.toBe(key2);
  });

  it('replies with an error message when mintCliToken throws', async () => {
    const ctx = makeCtx('/cli_link');
    const viewerMock = {
      mintCliToken: vi.fn().mockRejectedValue(new Error('API error')),
    };
    const api = {
      asViewer: vi.fn().mockReturnValue(viewerMock),
    } as unknown as ApiClient;

    await handleCliLink(ctx, api);

    const replyText: string = ctx.reply.mock.calls[0][0] as string;
    expect(replyText).not.toContain('orbit_pat_');
    expect(replyText.length).toBeGreaterThan(0);
  });
});
