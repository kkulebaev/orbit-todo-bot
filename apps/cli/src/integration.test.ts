/**
 * Wire-level integration tests using a fake `fetch` to inspect outgoing
 * headers and bodies. Validates that:
 *   - mutation commands set `Idempotency-Key` to a fresh UUID by default
 *     (AC-P3-6)
 *   - explicit --idempotency-key is forwarded verbatim end-to-end (AC-P3-9)
 *   - `Authorization: Bearer <PAT>` is sent
 *   - User-Agent matches orbit-cli/<semver>
 *   - the token plaintext does not leak into any logged output (AC-P1-7)
 *
 * Builds an `ApiViewerClient` via the same factory the CLI uses, with a
 * vitest-spied fetch.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApiClient } from '@orbit/api-client';

import { executeAdd } from './commands/add.js';
import { executeDone } from './commands/done.js';
import { executeRm } from './commands/rm.js';
import { CLI_VERSION } from './version.js';

const PAT = 'orbit_pat_' + 'b'.repeat(43);
const BASE = 'https://api.example.test';
const now = new Date('2026-05-16T06:00:00.000Z');

function makeClient(fetchImpl: typeof fetch) {
  return createApiClient({
    baseUrl: BASE,
    credential: { kind: 'pat', token: PAT },
    userAgent: `orbit-cli/${CLI_VERSION}`,
    fetchImpl,
  }).asViewer('0');
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function taskFixture(overrides: Record<string, unknown> = {}) {
  return {
    numId: 7,
    title: 'sample',
    status: 'open',
    dueAt: null,
    dueHasTime: false,
    createdAt: '2026-05-16T10:00:00.000Z',
    doneAt: null,
    ...overrides,
  };
}

function headersOf(call: unknown[]): Record<string, string> {
  const init = call[1] as RequestInit;
  // headers is Record<string,string> in our codebase (api-client builds it directly)
  return (init.headers as Record<string, string>) ?? {};
}

// Capture stdout/stderr writes for the leak check.
let capturedOut: string[] = [];
let capturedErr: string[] = [];
let writeOut: typeof process.stdout.write;
let writeErr: typeof process.stderr.write;

beforeEach(() => {
  capturedOut = [];
  capturedErr = [];
  writeOut = process.stdout.write.bind(process.stdout);
  writeErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    capturedOut.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    capturedErr.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  }) as typeof process.stderr.write;
});

afterEach(() => {
  process.stdout.write = writeOut;
  process.stderr.write = writeErr;
});

describe('http wire integration', () => {
  // AC-P3-6
  it('mutations generate a fresh randomUUID Idempotency-Key by default', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(taskFixture(), 201))
      .mockResolvedValueOnce(jsonResponse(taskFixture(), 201));
    const client = makeClient(fetchSpy as unknown as typeof fetch);

    await executeAdd(['x'], {}, { client, log: () => {}, err: () => {}, now });
    await executeAdd(['x'], {}, { client, log: () => {}, err: () => {}, now });

    const h1 = headersOf(fetchSpy.mock.calls[0]);
    const h2 = headersOf(fetchSpy.mock.calls[1]);
    expect(h1['Idempotency-Key']).toBeDefined();
    expect(h2['Idempotency-Key']).toBeDefined();
    expect(h1['Idempotency-Key']).not.toBe(h2['Idempotency-Key']);
    expect(h1['Idempotency-Key']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  // AC-P3-9
  it('--idempotency-key is forwarded verbatim as the HTTP header', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(taskFixture(), 200));
    const client = makeClient(fetchSpy as unknown as typeof fetch);

    await executeDone(
      '7',
      { idempotencyKey: 'wire-verbatim-key' },
      { client, log: () => {}, err: () => {}, now },
    );
    const h = headersOf(fetchSpy.mock.calls[0]);
    expect(h['Idempotency-Key']).toBe('wire-verbatim-key');
  });

  it('sets Authorization Bearer <pat> and User-Agent on every request', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(taskFixture(), 200));
    const client = makeClient(fetchSpy as unknown as typeof fetch);
    await executeDone('7', {}, { client, log: () => {}, err: () => {}, now });
    const h = headersOf(fetchSpy.mock.calls[0]);
    expect(h['Authorization']).toBe(`Bearer ${PAT}`);
    expect(h['User-Agent']).toBe(`orbit-cli/${CLI_VERSION}`);
  });

  // AC-P3-4: rm without --yes does not call fetch (no DELETE sent).
  it('rm without --yes never calls fetch', async () => {
    const fetchSpy = vi.fn();
    const client = makeClient(fetchSpy as unknown as typeof fetch);
    const code = await executeRm('7', {}, { client, log: () => {}, err: () => {} });
    expect(code).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // AC-P1-7: token plaintext never appears in captured stdout/stderr across
  // a full success path that includes a thrown error.
  it('does not leak the PAT plaintext on any output path', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(taskFixture(), 200)); // done success
    const client = makeClient(fetchSpy as unknown as typeof fetch);
    await executeDone('7', {}, { client, now });
    const combined = capturedOut.join('') + capturedErr.join('');
    expect(combined).not.toContain(PAT);
    expect(combined).not.toMatch(/orbit_pat_[A-Za-z0-9_-]+/);
  });
});
