import type { HostBlock } from '@/lib/status/types';

/**
 * The Host section's contents, as plain sentences.
 *
 * Kept apart from the component so the wording is testable, and because the wording is the
 * feature: whoever reads this runs a course, not a server, so every notice says what to do
 * and none of them name a file or a daemon.
 */

export type HostNotice = {
  id: string;
  tone: 'ok' | 'info' | 'warn';
  title: string;
  detail: string;
};

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

/** Why there is nothing to report, in the operator's terms rather than the mechanism's. */
export function hostUnavailableMessage(host: HostBlock): string {
  switch (host.reason) {
    case 'stale':
      return 'AFCT has not heard from the update service recently, so it cannot report on the server itself. It will fill in again on its own once that service is running.';
    case 'unsupported':
      return 'AFCT cannot read this server’s maintenance state. That is expected on Windows and on Linux distributions other than Ubuntu or Debian.';
    default:
      return 'The update service is not running, so AFCT cannot report on the server itself.';
  }
}

export function hostNotices(host: HostBlock): HostNotice[] {
  if (!host.available) return [];

  const notices: HostNotice[] = [];

  if (host.rebootRequired) {
    const packages = host.rebootPackages ?? [];
    const because =
      packages.length > 0
        ? ` The updates waiting on it include ${packages.slice(0, 3).join(', ')}${packages.length > 3 ? ` and ${packages.length - 3} more` : ''}.`
        : '';
    notices.push({
      id: 'reboot',
      tone: 'warn',
      title: 'This server needs to be restarted',
      detail: `Updates have been installed that only take effect after a restart.${because} Restart it at a time when nobody is using AFCT: everyone signed in will be signed out, and grading stops until it comes back.`,
    });
  }

  const security = host.securityUpdatesAvailable ?? 0;
  const total = host.updatesAvailable ?? 0;
  // Ubuntu leaves the security line out of its notice entirely when it has nothing to say
  // about them, which is not the same as saying there are none. Prod hits this case.
  const securityUnknown = host.securityUpdatesAvailable == null;

  if (security > 0) {
    notices.push({
      id: 'security-updates',
      tone: 'warn',
      title: `${security} security ${plural(security, 'update is', 'updates are')} waiting`,
      detail: `Ask whoever administers this server to install ${plural(security, 'it', 'them')}. Security updates are the ones worth not leaving.`,
    });
  } else if (total > 0) {
    notices.push({
      id: 'updates',
      tone: 'info',
      title: `${total} system ${plural(total, 'update is', 'updates are')} waiting`,
      detail: securityUnknown
        ? 'Whether any of them are security updates is not something AFCT can see from here. They are installed on the server itself, not through AFCT.'
        : 'None of them are security updates, so there is no hurry. They are installed on the server itself, not through AFCT.',
    });
  }

  if (host.timeSynchronised === false) {
    notices.push({
      id: 'clock',
      tone: 'warn',
      title: 'The server clock is not keeping time',
      detail: 'Fix this before it causes something stranger. A launch from Canvas, Moodle or Blackboard is signed and carries a timestamp, and those are refused when the two clocks disagree by more than a few minutes.',
    });
  }

  if (notices.length === 0) {
    notices.push({
      id: 'all-clear',
      tone: 'ok',
      title: 'Nothing needs doing on the server',
      detail: 'No restart is pending and no updates are waiting.',
    });
  }

  return notices;
}
