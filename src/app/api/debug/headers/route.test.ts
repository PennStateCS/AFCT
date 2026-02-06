import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';

import { GET } from './route';

describe('GET /api/debug/headers', () => {
  it('returns debug info', async () => {
    const req = new NextRequest('http://localhost/api/debug/headers?x=1', {
      headers: { 'x-test': 'value' },
    });
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      url: 'http://localhost/api/debug/headers?x=1',
      method: 'GET',
    });
    expect(body.headers['x-test']).toBe('value');
    expect(body.nextUrl.pathname).toBe('/api/debug/headers');
  });
});
