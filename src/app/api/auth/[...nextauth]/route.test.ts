import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({
  handlers: {
    GET: vi.fn(),
    POST: vi.fn(),
  },
}));

import { GET, POST } from './route';

describe('auth handler exports', () => {
  it('exports GET and POST handlers', () => {
    expect(typeof GET).toBe('function');
    expect(typeof POST).toBe('function');
  });
});
