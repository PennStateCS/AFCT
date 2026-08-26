import { describe, expect, it } from 'vitest';
import {
  hostCheckedMessage,
  hostNotices,
  hostSummary,
  hostUnavailableMessage,
} from './host-notices';
import type { HostBlock } from '@/lib/status/types';

const host = (extra: Partial<HostBlock> = {}): HostBlock => ({
  available: true,
  checkedAt: '2026-08-19T11:58:00Z',
  osName: 'Ubuntu 24.04.1 LTS',
  rebootRequired: false,
  rebootPackages: [],
  updatesAvailable: 0,
  securityUpdatesAvailable: 0,
  timeSynchronised: true,
  ...extra,
});

const ids = (block: HostBlock) => hostNotices(block).map((n) => n.id);

describe('what the Host section says', () => {
  it('says so plainly when there is nothing to do', () => {
    expect(ids(host())).toEqual(['all-clear']);
    expect(hostNotices(host())[0]?.tone).toBe('ok');
  });

  it('asks for a restart, and warns what a restart costs', () => {
    const [notice] = hostNotices(host({ rebootRequired: true }));

    expect(notice?.tone).toBe('warn');
    // Whoever reads this runs a course. The consequence they need is that people get signed
    // out and grading stops, not which packages asked for it.
    expect(notice?.detail).toMatch(/signed out/i);
    expect(notice?.detail).toMatch(/grading stops/i);
  });

  it('names a few of the packages behind a restart, and counts the rest', () => {
    const [notice] = hostNotices(
      host({ rebootRequired: true, rebootPackages: ['libc6', 'linux-image-generic', 'openssl', 'dbus', 'systemd'] }),
    );

    expect(notice?.detail).toContain('libc6');
    expect(notice?.detail).toContain('and 2 more');
  });

  it('treats security updates as worth acting on and the rest as not', () => {
    const security = hostNotices(host({ updatesAvailable: 12, securityUpdatesAvailable: 3 }))[0];
    expect(security?.id).toBe('security-updates');
    expect(security?.tone).toBe('warn');
    expect(security?.title).toContain('3 security updates are');

    const ordinary = hostNotices(host({ updatesAvailable: 12, securityUpdatesAvailable: 0 }))[0];
    expect(ordinary?.id).toBe('updates');
    expect(ordinary?.tone).toBe('info');
  });

  /**
   * Ubuntu prints the security line only when it has one, so a notice reading "16 updates
   * can be applied immediately" and nothing else means the security count is unknown. This
   * is what the production server actually looks like, and the first version of this text
   * turned it into "none of them are security updates", which nobody had established.
   */
  it('does not claim none are security updates when it could not count them', () => {
    const unknown = hostNotices(host({ updatesAvailable: 16, securityUpdatesAvailable: null }))[0];
    expect(unknown?.id).toBe('updates');
    expect(unknown?.detail).not.toMatch(/none of them/i);
    expect(unknown?.detail).toMatch(/not something AFCT can see/i);

    const none = hostNotices(host({ updatesAvailable: 16, securityUpdatesAvailable: 0 }))[0];
    expect(none?.detail).toMatch(/none of them/i);
  });

  it('says nothing about updates it could not count', () => {
    expect(ids(host({ updatesAvailable: null, securityUpdatesAvailable: null }))).toEqual(['all-clear']);
  });

  /** A clock AFCT cannot check is not a clock that is wrong. */
  it('mentions the clock only when it is known to be adrift', () => {
    expect(ids(host({ timeSynchronised: null }))).toEqual(['all-clear']);
    expect(ids(host({ timeSynchronised: false }))).toContain('clock');
    // The reason it matters here rather than in the abstract.
    expect(hostNotices(host({ timeSynchronised: false }))[0]?.detail).toMatch(/Canvas|Moodle/);
  });

  it('reports several things at once', () => {
    expect(ids(host({ rebootRequired: true, securityUpdatesAvailable: 2, timeSynchronised: false }))).toEqual([
      'reboot',
      'security-updates',
      'clock',
    ]);
  });

  it('says nothing at all when it has no report', () => {
    expect(hostNotices({ available: false, reason: 'no-report' })).toEqual([]);
  });

  it.each(['no-report', 'stale', 'unsupported'] as const)(
    'explains a missing report (%s) without blaming the operator',
    (reason) => {
      const message = hostUnavailableMessage({ available: false, reason });

      expect(message).toMatch(/cannot|not running/i);
      // The failure that matters: this must never read as an all-clear.
      expect(message).not.toMatch(/up to date|nothing needs doing/i);
    },
  );
});

describe('how fresh the Host section says it is', () => {
  const now = Date.parse('2026-08-19T12:01:00Z');

  it('says when it was checked and how often it looks again', () => {
    const message = hostCheckedMessage(host(), now);

    expect(message).toContain('Checked 3 minutes ago');
    expect(message).toMatch(/every 5 minutes/);
  });

  // The reason this exists: someone installed the updates, saw them still listed, and
  // reasonably concluded the run had not worked.
  it('explains why something just installed is still listed', () => {
    expect(hostCheckedMessage(host(), now)).toMatch(/takes a few minutes to drop off/i);
  });

  it('still gives the cadence when there is no usable timestamp', () => {
    for (const checkedAt of [undefined, 'not a date']) {
      const message = hostCheckedMessage(host({ checkedAt }), now);

      expect(message).not.toContain('Checked');
      expect(message).toMatch(/every 5 minutes/);
    }
  });
});

describe('the one-glance summary in the rail', () => {
  it('says all clear, and still says why', () => {
    const summary = hostSummary(host());

    expect(summary.tone).toBe('ok');
    expect(summary.badgeLabel).toBe('All clear');
    expect(summary.headline).toBe('Nothing needs doing on the server');
    expect(summary.rest).toEqual([]);
  });

  it('leads with the thing that needs doing, not the first thing on the list', () => {
    // Ordinary updates come back before the clock does, but the clock is the one that needs
    // acting on, and a card that opened with the quieter of the two would bury it.
    const summary = hostSummary(host({ updatesAvailable: 12, timeSynchronised: false }));

    expect(summary.tone).toBe('warn');
    expect(summary.badgeLabel).toBe('Needs attention');
    expect(summary.headline).toBe('The server clock is not keeping time');
    expect(summary.rest.map((n) => n.id)).toEqual(['updates']);
  });

  it('keeps ordinary updates as something to know rather than something to do', () => {
    const summary = hostSummary(host({ updatesAvailable: 12, securityUpdatesAvailable: 0 }));

    expect(summary.tone).toBe('info');
    expect(summary.badgeLabel).toBe('Updates waiting');
  });

  it('never reads as an all-clear when it has no report', () => {
    const summary = hostSummary({ available: false, reason: 'no-report' });

    expect(summary.tone).toBe('off');
    expect(summary.badgeLabel).toBe('Not available');
    expect(summary.headline).not.toMatch(/nothing needs doing/i);
    expect(summary.detail).toBe(hostUnavailableMessage({ available: false, reason: 'no-report' }));
  });
});
