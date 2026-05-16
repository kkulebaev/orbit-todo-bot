/**
 * Thin HTTP client for @orbit/api.
 *
 * Design:
 *   const client = createApiClient({ baseUrl, credential: { kind: 'service', token } });
 *   const api    = client.asViewer(String(from.id));
 *   const tasks  = await api.listTasks({ mode: 'my', page: 0 });
 *
 * `asViewer(telegramUserId)` returns a viewer-scoped client that injects
 * `X-Telegram-User-Id` on every request (service mode only). Cheap to call
 * per Telegram update — the base config (baseUrl, credential, fetchImpl) is shared.
 *
 * Error policy:
 *   - 404 on GET            → null (not an error)
 *   - 404 on PATCH/DELETE   → null / false (owner-mismatch is a normal flow)
 *   - 401 / 5xx             → throws ApiClientError
 *   - network / timeout     → throws ApiNetworkError
 *   - Zod schema mismatch   → logs warn + throws Error (schema-canary, P2)
 *
 * Retry policy:
 *   - GET: 1 retry on network/timeout error, 200ms backoff.
 *   - Mutates: no retry (idempotency-key guards double-write).
 */

import type {
  CommitSessionInput,
  CreateSessionInput,
  CreateTaskInput,
  SessionDto,
  SessionKind,
  TaskDto,
  TaskListResponse,
  UpdateSessionInput,
  UpdateTaskInput,
  UserDto,
} from '@orbit/contracts';
import {
  SessionDtoSchema,
  TaskDtoSchema,
  TaskListResponseSchema,
  UserDtoSchema,
} from '@orbit/contracts';

// ── Error classes ──────────────────────────────────────────────────────────────

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly bodyParsed: unknown,
  ) {
    super(`API error ${status}`);
    this.name = 'ApiClientError';
  }
}

export class ApiNetworkError extends Error {
  constructor(cause: unknown) {
    super(`API network error: ${String(cause)}`);
    this.name = 'ApiNetworkError';
    this.cause = cause;
  }
}

// ── Credential discriminated union ────────────────────────────────────────────

/**
 * `kind: 'pat'`     — Personal Access Token; user-scoped, no X-Telegram-User-Id.
 * `kind: 'service'` — Temporary bot service token retained for P1 only.
 *                     P2 deletes this variant once the bot migrates to its own
 *                     PAT with canImpersonate=true. Do NOT use in new code.
 */
export type Credential =
  | { kind: 'pat'; token: string }
  | { kind: 'service'; token: string };

// ── Config & types ────────────────────────────────────────────────────────────

type Logger = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

export type ApiClientConfig = {
  baseUrl: string;
  credential: Credential;
  /**
   * Optional User-Agent string sent on every request (e.g. `orbit-cli/0.1.0`).
   * Omitted when not set.
   */
  userAgent?: string;
  /** Injected in tests; defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
  logger?: Logger;
};

/** Structural Zod-compatible interface — avoids a direct `zod` import. */
interface ZodLike<T> {
  safeParse(data: unknown):
    | { success: true; data: T }
    | { success: false; error: { issues: unknown[] } };
}

type FetchOpts = {
  telegramUserId: string;
  method?: string;
  path: string;
  body?: unknown;
  idempotencyKey?: string;
  /** Allow one retry on network/timeout errors (GET-only). */
  retryOnNetworkError?: boolean;
};

// ── Header helpers ────────────────────────────────────────────────────────────

/**
 * Redacts sensitive header values for safe logging.
 * `authorization` and `idempotency-key` values are replaced with `'***'`.
 * All other headers are passed through unchanged.
 */
export function redactSensitiveHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const REDACTED = new Set(['authorization', 'idempotency-key']);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = REDACTED.has(k.toLowerCase()) ? '***' : v;
  }
  return out;
}

// ── Viewer client interface ───────────────────────────────────────────────────

export interface ApiViewerClient {
  // Tasks
  listTasks(params?: { mode?: 'my' | 'due-soon' | 'done'; page?: number }): Promise<TaskListResponse>;
  getTask(numId: number): Promise<TaskDto | null>;
  createTask(input: CreateTaskInput, idempotencyKey: string): Promise<TaskDto>;
  updateTask(numId: number, patch: UpdateTaskInput, idempotencyKey: string): Promise<TaskDto | null>;
  deleteTask(numId: number, idempotencyKey: string): Promise<boolean>;

  // Users
  upsertMe(): Promise<UserDto>;

  // Sessions
  getLatestSession(kind: SessionKind): Promise<SessionDto | null>;
  createSession(input: CreateSessionInput, idempotencyKey: string): Promise<SessionDto>;
  updateSession(id: string, patch: UpdateSessionInput, idempotencyKey: string): Promise<SessionDto | null>;
  deleteSession(id: string, idempotencyKey: string): Promise<boolean>;
  commitSession(id: string, input: CommitSessionInput, idempotencyKey: string): Promise<TaskDto | null>;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function doFetch(
  baseUrl: string,
  credential: Credential,
  userAgent: string | undefined,
  fetchImpl: typeof fetch,
  opts: FetchOpts,
  attempt: number,
): Promise<Response> {
  const { telegramUserId, method = 'GET', path, body, idempotencyKey } = opts;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${credential.token}`,
  };

  // Only service-mode credentials send X-Telegram-User-Id.
  // PAT mode does not — the server resolves the viewer from the PAT itself.
  // P2 will introduce bot-PAT mode with canImpersonate=true that re-enables
  // this header for callers with that bit set; out of scope for P0.
  if (credential.kind === 'service') {
    headers['X-Telegram-User-Id'] = telegramUserId;
  }

  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  if (userAgent) headers['User-Agent'] = userAgent;

  try {
    return await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(5_000),
    });
  } catch (err) {
    // Single retry for GET requests on network/timeout errors.
    if (opts.retryOnNetworkError && attempt === 1) {
      await sleep(200);
      return doFetch(baseUrl, credential, userAgent, fetchImpl, opts, 2);
    }
    throw new ApiNetworkError(err);
  }
}

async function parseBody(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

/** Convenience type: result of createApiClient(), used by consumers. */
export type ApiClient = ReturnType<typeof createApiClient>;

export function createApiClient(cfg: ApiClientConfig) {
  const { baseUrl, credential, userAgent, fetchImpl = globalThis.fetch, logger } = cfg;

  /**
   * Typed request with Zod validation.
   * Returns null when the status is in `nullStatuses`.
   * Throws ApiClientError on 4xx/5xx (except nullStatuses).
   * Throws Error on schema mismatch (logged as warn first).
   */
  async function req<T>(
    opts: FetchOpts & { schema: ZodLike<T> },
    okStatuses: readonly number[],
    nullStatuses: readonly number[] = [],
  ): Promise<T | null> {
    const res = await doFetch(baseUrl, credential, userAgent, fetchImpl, opts, 1);

    if (nullStatuses.includes(res.status)) return null;

    if (!okStatuses.includes(res.status)) {
      const bodyParsed = await parseBody(res);
      throw new ApiClientError(res.status, bodyParsed);
    }

    const json = await parseBody(res);
    const parsed = opts.schema.safeParse(json);

    if (!parsed.success) {
      logger?.warn('api-client: schema mismatch', {
        path: opts.path,
        issues: parsed.error.issues,
      });
      throw new Error(
        `api-client schema mismatch on ${opts.path}: ${JSON.stringify(parsed.error.issues)}`,
      );
    }

    return parsed.data;
  }

  /**
   * Boolean request for operations that return 204 (e.g. DELETE).
   * Returns false when the status is in `nullStatuses`.
   */
  async function reqBool(
    opts: FetchOpts,
    successStatus: number,
    nullStatuses: readonly number[] = [],
  ): Promise<boolean> {
    const res = await doFetch(baseUrl, credential, userAgent, fetchImpl, opts, 1);

    if (nullStatuses.includes(res.status)) return false;
    if (res.status === successStatus) return true;

    const bodyParsed = await parseBody(res);
    throw new ApiClientError(res.status, bodyParsed);
  }

  return {
    /**
     * Returns a viewer-scoped client. Cheap to create per Telegram update.
     *
     * @param telegramUserId  stringified BigInt from ctx.from.id
     */
    asViewer(telegramUserId: string): ApiViewerClient {
      const v: Pick<FetchOpts, 'telegramUserId'> = { telegramUserId };

      return {
        // ── Tasks ────────────────────────────────────────────────────────

        async listTasks(
          params: { mode?: 'my' | 'due-soon' | 'done'; page?: number } = {},
        ): Promise<TaskListResponse> {
          const qs = new URLSearchParams();
          if (params.mode) qs.set('mode', params.mode);
          if (params.page !== undefined) qs.set('page', String(params.page));
          const qStr = qs.toString();
          const path = `/v1/tasks${qStr ? `?${qStr}` : ''}`;
          const result = await req(
            { ...v, path, schema: TaskListResponseSchema, retryOnNetworkError: true },
            [200],
          );
          return result!;
        },

        async getTask(numId: number): Promise<TaskDto | null> {
          return req(
            { ...v, path: `/v1/tasks/${numId}`, schema: TaskDtoSchema, retryOnNetworkError: true },
            [200],
            [404],
          );
        },

        async createTask(input: CreateTaskInput, idempotencyKey: string): Promise<TaskDto> {
          const result = await req(
            {
              ...v,
              method: 'POST',
              path: '/v1/tasks',
              body: input,
              idempotencyKey,
              schema: TaskDtoSchema,
            },
            [201],
          );
          return result!;
        },

        async updateTask(
          numId: number,
          patch: UpdateTaskInput,
          idempotencyKey: string,
        ): Promise<TaskDto | null> {
          return req(
            {
              ...v,
              method: 'PATCH',
              path: `/v1/tasks/${numId}`,
              body: patch,
              idempotencyKey,
              schema: TaskDtoSchema,
            },
            [200],
            [404],
          );
        },

        async deleteTask(numId: number, idempotencyKey: string): Promise<boolean> {
          return reqBool(
            { ...v, method: 'DELETE', path: `/v1/tasks/${numId}`, idempotencyKey },
            204,
            [404],
          );
        },

        // ── Users ────────────────────────────────────────────────────────

        async upsertMe(): Promise<UserDto> {
          const result = await req(
            { ...v, path: '/v1/users/me', schema: UserDtoSchema, retryOnNetworkError: true },
            [200],
          );
          return result!;
        },

        // ── Sessions ─────────────────────────────────────────────────────

        async getLatestSession(kind: SessionKind): Promise<SessionDto | null> {
          const qs = new URLSearchParams({ kind });
          return req(
            {
              ...v,
              path: `/v1/sessions/latest?${qs.toString()}`,
              schema: SessionDtoSchema,
              retryOnNetworkError: true,
            },
            [200],
            [404],
          );
        },

        async createSession(
          input: CreateSessionInput,
          idempotencyKey: string,
        ): Promise<SessionDto> {
          const result = await req(
            {
              ...v,
              method: 'POST',
              path: '/v1/sessions',
              body: input,
              idempotencyKey,
              schema: SessionDtoSchema,
            },
            [201],
          );
          return result!;
        },

        async updateSession(
          id: string,
          patch: UpdateSessionInput,
          idempotencyKey: string,
        ): Promise<SessionDto | null> {
          return req(
            {
              ...v,
              method: 'PATCH',
              path: `/v1/sessions/${id}`,
              body: patch,
              idempotencyKey,
              schema: SessionDtoSchema,
            },
            [200],
            [404],
          );
        },

        async deleteSession(id: string, idempotencyKey: string): Promise<boolean> {
          return reqBool(
            { ...v, method: 'DELETE', path: `/v1/sessions/${id}`, idempotencyKey },
            204,
            [404],
          );
        },

        async commitSession(
          id: string,
          input: CommitSessionInput,
          idempotencyKey: string,
        ): Promise<TaskDto | null> {
          return req(
            {
              ...v,
              method: 'POST',
              path: `/v1/sessions/${id}/commit`,
              body: input,
              idempotencyKey,
              schema: TaskDtoSchema,
            },
            [200],
            [404],
          );
        },
      };
    },
  };
}
