import { describe, expect, it } from 'vitest';

import { ApiClientError, ApiNetworkError } from '@orbit/api-client';

import {
  EXIT_AUTH,
  EXIT_GENERIC,
  EXIT_NETWORK,
  EXIT_NOT_FOUND,
  exitFromError,
} from './exit-codes.js';

describe('exitFromError', () => {
  it('maps 401 to AUTH', () => {
    expect(exitFromError(new ApiClientError(401, { e: 'unauth' }))).toBe(EXIT_AUTH);
  });
  it('maps 404 to NOT_FOUND', () => {
    expect(exitFromError(new ApiClientError(404, {}))).toBe(EXIT_NOT_FOUND);
  });
  it('maps 5xx to GENERIC', () => {
    expect(exitFromError(new ApiClientError(500, {}))).toBe(EXIT_GENERIC);
  });
  it('maps ApiNetworkError to NETWORK', () => {
    expect(exitFromError(new ApiNetworkError(new Error('ECONNREFUSED')))).toBe(EXIT_NETWORK);
  });
  it('maps anything else to GENERIC', () => {
    expect(exitFromError(new Error('oops'))).toBe(EXIT_GENERIC);
    expect(exitFromError('bare-string')).toBe(EXIT_GENERIC);
    expect(exitFromError(undefined)).toBe(EXIT_GENERIC);
  });
});
