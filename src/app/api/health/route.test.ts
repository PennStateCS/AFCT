import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/health', () => {
  it('uses fallback values when env vars are missing', async () => {
    vi.stubEnv('NODE_ENV', undefined);
    vi.stubEnv('npm_package_version', undefined);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.environment).toBe('unknown');
    expect(body.version).toBe('0.1.0');
  });

  it('returns ok status payload', async () => {
    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.timestamp).toBeDefined();
    expect(body.uptime).toBeTypeOf('number');
  });

  it('returns env and version from process env when present', async () => {
    vi.stubEnv('NODE_ENV', 'test-env');
    vi.stubEnv('npm_package_version', '9.9.9');

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.environment).toBe('test-env');
    expect(body.version).toBe('9.9.9');
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
