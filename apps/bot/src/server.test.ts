import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from './server.js';

describe('server', () => {
  it('GET /healthz returns ok', async () => {
    const app = createApp({ handleUpdate: async () => {} });
    await request(app).get('/healthz').expect(200).expect('ok');
  });
});
