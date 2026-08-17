/**
 * A failed probe has to leave a trace.
 *
 * The status collectors ask a lot of optional questions and are meant to carry on when one goes
 * unanswered. They were doing that by discarding the error, which made a probe that failed
 * indistinguishable from one that found nothing: an empty field on the page, an empty log, and
 * two very different explanations for it in an incident.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { probeFailed } from './probe';

afterEach(() => vi.restoreAllMocks());

describe('probeFailed', () => {
  it('names what failed and why', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    probeFailed('database: max_connections', new Error('permission denied for pg_settings'));

    // Both halves matter: which value is now missing, and what stopped it being collected.
    expect(warn).toHaveBeenCalledWith(
      '[status] database: max_connections: permission denied for pg_settings',
    );
  });

  it('still says something when what was thrown is not an Error', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    probeFailed('docker: cgroup version detection', 'no such file');

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('docker: cgroup version detection');
  });

  it('does not throw, whatever it is handed', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    // It runs inside a catch block. Throwing here would turn a missing optional value into a
    // failed request, which is the one thing this must never do.
    expect(() => probeFailed('x', undefined)).not.toThrow();
    expect(() => probeFailed('x', null)).not.toThrow();
    expect(() => probeFailed('x', { nested: { cyclic: true } })).not.toThrow();
  });
});
