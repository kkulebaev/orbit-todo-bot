import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError, ApiNetworkError, createApiClient, redactSensitiveHeaders } from './index.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BASE_URL = 'https://api.example.com';
const PAT_CREDENTIAL = { kind: 'pat' as const, token: 'pat-token' };
const TG_USER_ID = '999888777';
const IK = 'idem-key-abc';

const TASK_DTO = {
  numId: 7,
  title: 'Buy milk',
  status: 'open' as const,
  dueAt: null,
  dueHasTime: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  doneAt: null,
};

const TASK_LIST = { items: [TASK_DTO], page: 0, total: 1 };

const USER_DTO = {
  numId: 42,
  telegramUserId: TG_USER_ID,
};

/** Minimal Response-like object for mocking — no real network. */
function mockRes(status: number, body: unknown = null): Response {
  return { status, json: async () => body } as unknown as Response;
}

function makeClient(fetchMock: ReturnType<typeof vi.fn>, credential = PAT_CREDENTIAL) {
  return createApiClient({
    baseUrl: BASE_URL,
    credential,
    fetchImpl: fetchMock as unknown as typeof fetch,
  }).asViewer(TG_USER_ID);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('api-client', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
  });

  // 1. listTasks 200 → parsed TaskListResponse
  it('listTasks: 200 returns parsed TaskListResponse', async () => {
    fetchMock.mockResolvedValue(mockRes(200, TASK_LIST));
    const result = await makeClient(fetchMock).listTasks({ mode: 'my', page: 0 });
    expect(result).toEqual(TASK_LIST);
  });

  // 2. listTasks 5xx → throws ApiClientError with correct status
  it('listTasks: 500 throws ApiClientError with status 500', async () => {
    fetchMock.mockResolvedValue(mockRes(500, { error: 'internal server error' }));
    const err = await makeClient(fetchMock).listTasks().catch((e) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect((err as ApiClientError).status).toBe(500);
  });

  // 3. getTask 404 → returns null (not throw)
  it('getTask: 404 returns null without throwing', async () => {
    fetchMock.mockResolvedValue(mockRes(404, null));
    const result = await makeClient(fetchMock).getTask(99);
    expect(result).toBeNull();
  });

  // 4. createTask 201 + Idempotency-Key header passed to fetch
  it('createTask: sends Idempotency-Key header and returns TaskDto on 201', async () => {
    fetchMock.mockResolvedValue(mockRes(201, TASK_DTO));
    const result = await makeClient(fetchMock).createTask({ title: 'Buy milk' }, IK);
    expect(result).toEqual(TASK_DTO);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe(IK);
  });

  // 5. createTask: invalid Zod shape → throws
  it('createTask: Zod schema mismatch on response body throws', async () => {
    fetchMock.mockResolvedValue(mockRes(201, { numId: 'not-a-number', title: 123 }));
    await expect(makeClient(fetchMock).createTask({ title: 'Buy milk' }, IK)).rejects.toThrow(
      /schema mismatch/,
    );
  });

  // 6. upsertMe → X-Telegram-User-Id header always sent (server decides honor/ignore).
  it('upsertMe: PAT mode sends X-Telegram-User-Id header (server decides whether to honor)', async () => {
    fetchMock.mockResolvedValue(mockRes(200, USER_DTO));
    await makeClient(fetchMock, PAT_CREDENTIAL).upsertMe();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['X-Telegram-User-Id']).toBe(TG_USER_ID);
  });

  // 7. timeout: fetch throwing (AbortSignal) → ApiNetworkError
  it('timeout: fetch throwing DOMException (AbortSignal timeout) throws ApiNetworkError', async () => {
    const abortErr = new DOMException('signal timed out', 'TimeoutError');
    // deleteTask has no retry — single throw → ApiNetworkError immediately
    fetchMock.mockRejectedValue(abortErr);
    await expect(makeClient(fetchMock).deleteTask(1, IK)).rejects.toBeInstanceOf(ApiNetworkError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // 8. GET retry: 1st attempt network error, 2nd success → returns body
  it('GET retry: retries once on network error and returns result on second attempt', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(mockRes(200, TASK_LIST));
    const result = await makeClient(fetchMock).listTasks();
    expect(result).toEqual(TASK_LIST);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // 9. POST no retry: network error on POST → throws immediately (fetchMock called once)
  it('POST no retry: createTask network error throws ApiNetworkError without retrying', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    await expect(
      makeClient(fetchMock).createTask({ title: 'Buy milk' }, IK),
    ).rejects.toBeInstanceOf(ApiNetworkError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // 10. deleteTask 204 → true
  it('deleteTask: 204 returns true', async () => {
    fetchMock.mockResolvedValue(mockRes(204, null));
    expect(await makeClient(fetchMock).deleteTask(7, IK)).toBe(true);
  });

  // 11. deleteTask 404 → false
  it('deleteTask: 404 returns false', async () => {
    fetchMock.mockResolvedValue(mockRes(404, null));
    expect(await makeClient(fetchMock).deleteTask(99, IK)).toBe(false);
  });

  // 12. Authorization header carries the PAT bearer token.
  it('PAT mode: Authorization header is Bearer <token>', async () => {
    fetchMock.mockResolvedValue(mockRes(200, USER_DTO));
    await makeClient(fetchMock, PAT_CREDENTIAL).upsertMe();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBe(
      `Bearer ${PAT_CREDENTIAL.token}`,
    );
  });

  // 13. redactSensitiveHeaders unit test (AC-P0-7)
  it('redactSensitiveHeaders: masks Authorization and Idempotency-Key, passes Content-Type through', () => {
    const input = {
      Authorization: 'Bearer super-secret-token',
      'Idempotency-Key': 'k1-plaintext',
      'Content-Type': 'application/json',
    };
    const out = redactSensitiveHeaders(input);
    expect(out['Authorization']).toBe('***');
    expect(out['Idempotency-Key']).toBe('***');
    expect(out['Content-Type']).toBe('application/json');
  });

  // 14. Logger integration: token and idempotency-key plaintext must not appear in logger output (AC-P0-7)
  it('logger integration: token and idempotency-key plaintext never appear in warn output', async () => {
    const warnMessages: string[] = [];
    const captureLogger = {
      info: () => {},
      warn: (...args: unknown[]) => { warnMessages.push(JSON.stringify(args)); },
      error: () => {},
    };

    // Trigger a schema-mismatch warn by returning an invalid body shape
    fetchMock.mockResolvedValue(mockRes(201, { numId: 'bad', title: 123 }));
    const client = createApiClient({
      baseUrl: BASE_URL,
      credential: PAT_CREDENTIAL,
      fetchImpl: fetchMock as unknown as typeof fetch,
      logger: captureLogger,
    });

    await client.asViewer(TG_USER_ID).createTask({ title: 'x' }, IK).catch(() => {});

    const combined = warnMessages.join('\n');
    // Token plaintext must not appear in any logger output
    expect(combined).not.toMatch(/pat-token/);
    // Idempotency-key plaintext must not appear in any logger output
    expect(combined).not.toMatch(/idem-key-abc/);
  });

  // 15. mintCliToken: 201 returns MintCliTokenResponse
  it('mintCliToken: 201 returns MintCliTokenResponse', async () => {
    const mintResponse = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      token: 'orbit_pat_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      label: 'my laptop',
      expiresAt: '2027-01-01T00:00:00.000Z',
    };
    fetchMock.mockResolvedValue(mockRes(201, mintResponse));
    const result = await makeClient(fetchMock).mintCliToken(
      { telegramUserId: TG_USER_ID, label: 'my laptop', ttlDays: 365 },
      IK,
    );
    expect(result).toEqual(mintResponse);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe(IK);
  });

  // 16. mintCliToken: 403 from user-PAT → throws ApiClientError(403)
  it('mintCliToken: 403 throws ApiClientError with status 403', async () => {
    fetchMock.mockResolvedValue(mockRes(403, { error: { code: 'forbidden', message: 'forbidden' } }));
    const err = await makeClient(fetchMock)
      .mintCliToken({ telegramUserId: TG_USER_ID }, IK)
      .catch((e) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect((err as ApiClientError).status).toBe(403);
  });

  // 17. listCliTokens: 200 returns array of PersonalAccessTokenDto
  it('listCliTokens: 200 returns array of PersonalAccessTokenDto', async () => {
    const tokens = [
      {
        id: '550e8400-e29b-41d4-a716-446655440001',
        label: 'laptop',
        createdAt: '2026-01-01T00:00:00.000Z',
        lastUsedAt: null,
        expiresAt: null,
      },
    ];
    fetchMock.mockResolvedValue(mockRes(200, tokens));
    const result = await makeClient(fetchMock).listCliTokens();
    expect(result).toEqual(tokens);
  });

  // 18. revokeCliToken: 204 returns true
  it('revokeCliToken: 204 returns true', async () => {
    fetchMock.mockResolvedValue(mockRes(204, null));
    const result = await makeClient(fetchMock).revokeCliToken(
      '550e8400-e29b-41d4-a716-446655440001',
      IK,
    );
    expect(result).toBe(true);
  });

  // 19. revokeCliToken: 404 returns false (other-user's token → privacy-preserving)
  it('revokeCliToken: 404 returns false without throwing', async () => {
    fetchMock.mockResolvedValue(mockRes(404, null));
    const result = await makeClient(fetchMock).revokeCliToken(
      '550e8400-e29b-41d4-a716-446655440099',
      IK,
    );
    expect(result).toBe(false);
  });

  // 20. getVersion: 200 returns VersionInfoDto
  it('getVersion: 200 returns VersionInfoDto', async () => {
    const versionDto = {
      contractsVersion: '0.1.0',
      commit: 'abc1234',
      builtAt: '2026-01-01T00:00:00.000Z',
    };
    fetchMock.mockResolvedValue(mockRes(200, versionDto));
    const result = await makeClient(fetchMock).getVersion();
    expect(result).toEqual(versionDto);
  });
});
