import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchAssignmentLmsLinks } from '@/lib/lti/fetch-assignment-links';

/**
 * The distinction this exists to keep: "there are none" and "I could not find out" are
 * different answers, and the screen says different things about them.
 */

const respond = (body: unknown, ok = true, status = 200) =>
  vi.fn().mockResolvedValue({ ok, status, json: async () => body });

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchAssignmentLmsLinks', () => {
  it('returns the links when there are some', async () => {
    const link = { id: 'l1', platform: 'Moodle', context: 'MDL 101', addedAt: 'x', addedBy: null };
    vi.stubGlobal('fetch', respond({ links: [link] }));

    await expect(fetchAssignmentLmsLinks('c1', 'a1')).resolves.toEqual([link]);
  });

  it('returns an empty list when the answer really is none', async () => {
    vi.stubGlobal('fetch', respond({ links: [] }));

    await expect(fetchAssignmentLmsLinks('c1', 'a1')).resolves.toEqual([]);
  });

  it('throws when the server refuses, rather than reporting none', async () => {
    for (const status of [401, 403, 404, 500]) {
      vi.stubGlobal('fetch', respond({}, false, status));

      await expect(fetchAssignmentLmsLinks('c1', 'a1')).rejects.toThrow(String(status));
    }
  });

  it('throws when the network fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('Failed to fetch')),
    );

    await expect(fetchAssignmentLmsLinks('c1', 'a1')).rejects.toThrow('Failed to fetch');
  });

  it('throws on a body it does not understand', async () => {
    vi.stubGlobal('fetch', respond({ links: 'all of them' }));

    await expect(fetchAssignmentLmsLinks('c1', 'a1')).rejects.toThrow(/shape/);
  });
});
