import { describe, expect, it } from 'vitest';
import { readHostFacts, HOST_FACTS_MAX_AGE_MS } from './host';

/**
 * The rule this file exists to keep: AFCT never reports a server as fine on no evidence.
 *
 * Every way of failing to learn something has to come back `available: false`, because the
 * screen turns that into "AFCT cannot tell" while `available: true` turns into a list that
 * an operator reads as complete.
 */

const NOW = Date.parse('2026-08-19T12:00:00Z');
const fresh = (extra: Record<string, unknown> = {}) => ({
  checkedAt: '2026-08-19T11:58:00Z',
  supported: true,
  osName: 'Ubuntu 24.04.1 LTS',
  rebootRequired: false,
  rebootPackages: [],
  updatesAvailable: 0,
  securityUpdatesAvailable: 0,
  timeSynchronised: true,
  ...extra,
});

describe('reading a host report', () => {
  it('reads a current one', () => {
    expect(readHostFacts(fresh({ rebootRequired: true, rebootPackages: ['linux-image-generic'] }), NOW)).toEqual({
      available: true,
      checkedAt: '2026-08-19T11:58:00Z',
      osName: 'Ubuntu 24.04.1 LTS',
      rebootRequired: true,
      rebootPackages: ['linux-image-generic'],
      updatesAvailable: 0,
      securityUpdatesAvailable: 0,
      timeSynchronised: true,
    });
  });

  it('refuses a report older than the limit', () => {
    const old = new Date(NOW - HOST_FACTS_MAX_AGE_MS - 1000).toISOString();
    expect(readHostFacts(fresh({ checkedAt: old, rebootRequired: true }), NOW)).toEqual({
      available: false,
      reason: 'stale',
      checkedAt: old,
    });
  });

  it('refuses a host the updater could not recognise', () => {
    expect(readHostFacts(fresh({ supported: false }), NOW)).toMatchObject({
      available: false,
      reason: 'unsupported',
    });
  });

  it.each([[null], [undefined], ['not json'], [42], [{}], [{ supported: true }]])(
    'refuses a report it cannot read: %s',
    (raw) => {
      expect(readHostFacts(raw, NOW).available).toBe(false);
    },
  );

  /**
   * A count AFCT could not determine is null, not zero. Zero is a statement that there is
   * nothing waiting, and the screen prints it as one.
   */
  it('keeps "unknown" apart from "none"', () => {
    const unknown = readHostFacts(fresh({ updatesAvailable: null, securityUpdatesAvailable: 'lots' }), NOW);

    expect(unknown.updatesAvailable).toBeNull();
    expect(unknown.securityUpdatesAvailable).toBeNull();
    expect(readHostFacts(fresh({ updatesAvailable: 0 }), NOW).updatesAvailable).toBe(0);
  });

  it('keeps an unknown clock apart from a wrong one', () => {
    expect(readHostFacts(fresh({ timeSynchronised: null }), NOW).timeSynchronised).toBeNull();
    expect(readHostFacts(fresh({ timeSynchronised: false }), NOW).timeSynchronised).toBe(false);
  });

  it('drops package names that are not strings', () => {
    expect(readHostFacts(fresh({ rebootPackages: ['libc6', 7, null] }), NOW).rebootPackages).toEqual(['libc6']);
  });
});
