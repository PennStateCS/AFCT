import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/health', () => {
  it('returns ok status payload', async () => {
    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.timestamp).toBeDefined();
    expect(body.uptime).toBeTypeOf('number');
  });

  it('returns 503 when uptime throws', async () => {
    const uptimeSpy = vi.spyOn(process, 'uptime').mockImplementation(() => {
      throw new Error('boom');
    });

    const res = await GET();

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe('error');
    uptimeSpy.mockRestore();
  });
});
