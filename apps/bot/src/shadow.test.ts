import { describe, it, expect, vi } from 'vitest';
import { shadowCompare, type ShadowConfig } from './shadow.js';

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe('shadowCompare', () => {
  it('does not call apiCall when enabled=false', async () => {
    const apiCall = vi.fn().mockResolvedValue(undefined);
    const logger = makeLogger();
    const cfg: ShadowConfig = { enabled: false, apiClient: null, logger };

    await shadowCompare(cfg, 'listTasks:my', apiCall);

    expect(apiCall).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('does not call apiCall when apiClient=null even if enabled=true', async () => {
    const apiCall = vi.fn().mockResolvedValue(undefined);
    const logger = makeLogger();
    const cfg: ShadowConfig = { enabled: true, apiClient: null, logger };

    await shadowCompare(cfg, 'getTask:42', apiCall);

    expect(apiCall).not.toHaveBeenCalled();
  });

  it('logs info on successful apiCall', async () => {
    const apiCall = vi.fn().mockResolvedValue({ numId: 1, title: 'test' });
    const logger = makeLogger();
    const cfg: ShadowConfig = {
      enabled: true,
      apiClient: {} as any, // non-null; apiCall is provided externally
      logger,
    };

    await shadowCompare(cfg, 'listTasks:my', apiCall);

    expect(apiCall).toHaveBeenCalledOnce();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ shadow: 'listTasks:my', status: 'ok' }),
      'shadow call',
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('logs warn and does not throw when apiCall fails', async () => {
    const apiCall = vi.fn().mockRejectedValue(new Error('schema mismatch on /v1/tasks'));
    const logger = makeLogger();
    const cfg: ShadowConfig = {
      enabled: true,
      apiClient: {} as any,
      logger,
    };

    await expect(shadowCompare(cfg, 'getTask:7', apiCall)).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        shadow: 'getTask:7',
        err: 'schema mismatch on /v1/tasks',
      }),
      'shadow call diverged',
    );
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('logs warn with stringified error when non-Error is thrown', async () => {
    const apiCall = vi.fn().mockRejectedValue('network timeout');
    const logger = makeLogger();
    const cfg: ShadowConfig = {
      enabled: true,
      apiClient: {} as any,
      logger,
    };

    await expect(shadowCompare(cfg, 'upsertMe', apiCall)).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ shadow: 'upsertMe', err: 'network timeout' }),
      'shadow call diverged',
    );
  });
});
