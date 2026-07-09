import { describe, expect, it } from 'vitest';
import { apiError } from './http';

describe('apiError', () => {
  it('builds a JSON { error } body with the given status', async () => {
    const res = apiError(403, 'Forbidden');
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: 'Forbidden' });
  });

  it('carries arbitrary status codes and messages', async () => {
    const res = apiError(404, 'File not found on disk');
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'File not found on disk' });
  });
});
