import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { renewIfNeededMock } = vi.hoisted(() => ({ renewIfNeededMock: vi.fn() }));
vi.mock('@/lib/acme', () => ({ renewIfNeeded: renewIfNeededMock }));

import { __test__ } from './tls-renewal';

describe('tls-renewal checkOnce', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('logs a success line when a renewal happens', async () => {
    renewIfNeededMock.mockResolvedValue({ renewed: true, domain: 'afct.example.edu' });
    await __test__.checkOnce();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('afct.example.edu'));
    expect(console.error).not.toHaveBeenCalled();
  });

  it('stays quiet when nothing is due or not managed', async () => {
    renewIfNeededMock.mockResolvedValue({ renewed: false, reason: 'not-due' });
    await __test__.checkOnce();
    expect(console.log).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it('logs an error when a real renewal failure is reported', async () => {
    renewIfNeededMock.mockResolvedValue({ renewed: false, reason: 'order failed' });
    await __test__.checkOnce();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('order failed'));
  });

  it('never throws when renewIfNeeded rejects', async () => {
    renewIfNeededMock.mockRejectedValue(new Error('boom'));
    await expect(__test__.checkOnce()).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});
