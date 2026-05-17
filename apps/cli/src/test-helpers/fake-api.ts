import { vi } from 'vitest';
import type { ApiViewerClient } from '@orbit/api-client';
import type {
  MintCliTokenResponse,
  PersonalAccessTokenDto,
  TaskDto,
  TaskListResponse,
  UserDto,
  VersionInfoDto,
} from '@orbit/contracts';

/**
 * A vitest-spy implementation of `ApiViewerClient` for unit tests. Every
 * method is a `vi.fn()` returning a resolved Promise with a default value;
 * tests override per-call with `.mockResolvedValueOnce(...)` or
 * `.mockRejectedValueOnce(...)`.
 *
 * The session methods are stubbed for interface completeness; CLI tests
 * never exercise them.
 */
export type FakeApi = ApiViewerClient & {
  // Re-typed as Mock so tests can use mockResolvedValueOnce / mockRejectedValueOnce.
  listTasks: ReturnType<typeof vi.fn>;
  getTask: ReturnType<typeof vi.fn>;
  createTask: ReturnType<typeof vi.fn>;
  updateTask: ReturnType<typeof vi.fn>;
  deleteTask: ReturnType<typeof vi.fn>;
  upsertMe: ReturnType<typeof vi.fn>;
  mintCliToken: ReturnType<typeof vi.fn>;
  listCliTokens: ReturnType<typeof vi.fn>;
  revokeCliToken: ReturnType<typeof vi.fn>;
  getVersion: ReturnType<typeof vi.fn>;
};

export function makeFakeApi(overrides: Partial<FakeApi> = {}): FakeApi {
  const defaultUser: UserDto = {
    numId: 1,
    telegramUserId: '42',
  };
  const defaultList: TaskListResponse = { items: [], page: 0, total: 0 };
  const defaultVersion: VersionInfoDto = {
    contractsVersion: '0.1.0',
    commit: 'test',
    builtAt: '2026-05-16T00:00:00.000Z',
  };
  const defaultTask = makeTask();
  const defaultMint: MintCliTokenResponse = {
    id: '00000000-0000-0000-0000-000000000000',
    token: 'orbit_pat_' + 'A'.repeat(43),
    label: null,
    expiresAt: null,
  };

  const api: FakeApi = {
    listTasks: vi.fn().mockResolvedValue(defaultList),
    getTask: vi.fn().mockResolvedValue(null as TaskDto | null),
    createTask: vi.fn().mockResolvedValue(defaultTask),
    updateTask: vi.fn().mockResolvedValue(null as TaskDto | null),
    deleteTask: vi.fn().mockResolvedValue(true),
    upsertMe: vi.fn().mockResolvedValue(defaultUser),
    getLatestSession: vi.fn().mockResolvedValue(null),
    createSession: vi.fn().mockResolvedValue(undefined),
    updateSession: vi.fn().mockResolvedValue(null),
    deleteSession: vi.fn().mockResolvedValue(true),
    commitSession: vi.fn().mockResolvedValue(null),
    mintCliToken: vi.fn().mockResolvedValue(defaultMint),
    listCliTokens: vi.fn().mockResolvedValue([] as PersonalAccessTokenDto[]),
    revokeCliToken: vi.fn().mockResolvedValue(true),
    getVersion: vi.fn().mockResolvedValue(defaultVersion),
  };

  return Object.assign(api, overrides);
}

/** Builds a `TaskDto` with sensible defaults; overrides override field-by-field. */
export function makeTask(overrides: Partial<TaskDto> = {}): TaskDto {
  return {
    numId: 1,
    title: 'sample',
    status: 'open',
    dueAt: null,
    dueHasTime: false,
    createdAt: '2026-05-16T10:00:00.000Z',
    doneAt: null,
    ...overrides,
  };
}
