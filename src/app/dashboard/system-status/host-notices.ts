import type { HostBlock } from '@/lib/status/types';
import { formatRelative } from './status-format';

/**
 * How often the updater rewrites its report, mirroring its own UPDATER_HOST_FACTS_INTERVAL
 * default of 300 seconds. Declared here rather than imported from lib/status/host, because
 * this module is pulled into the client bundle and that one reads the filesystem.
 */
export const HOST_FACTS_REFRESH_MINUTES = 5;

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

/**
 * When this was last looked at, and how often it is looked at again.
 *
 * Both halves earn their place. The notices above are written in the present tense, but the
 * updater only rereads the server every few minutes, so an operator who has just installed
 * updates sees them still listed and concludes the run failed. That happened the first time
 * this section was used in anger.
 */
export function hostCheckedMessage(host: HostBlock, now: number): string {
  const cadence = `AFCT checks again every ${HOST_FACTS_REFRESH_MINUTES} minutes, so anything just installed on the server takes a few minutes to drop off this list.`;
  const at = host.checkedAt ? Date.parse(host.checkedAt) : Number.NaN;
  if (!Number.isFinite(at)) return cadence;
  return `Checked ${formatRelative(at, now)}. ${cadence}`;
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

/**
 * The one-glance version of the notices above, for the card in the Server tab's rail.
 *
 * The card leads with a state before it leads with a paragraph, so something has to decide
 * which state the notices add up to, and which of them to put first. That decision is here,
 * beside the notices themselves, for the reason the rest of this file exists: the words are
 * the feature, and they are easier to get right when they are testable.
 *
 * The lead is the first notice that needs doing something about, not simply the first one:
 * a drifting clock and ordinary updates can be reported together, and it is the clock the
 * card should open with. Its title becomes the headline and its detail sits directly under
 * it, so nothing is written twice; `rest` is everything else, still most-urgent first.
 */
export type HostSummary = {
  /** Which glyph and colour the card shows. One of `SettingsStatusTone`. */
  tone: 'ok' | 'off' | 'info' | 'warn';
  /** The state's name, on the badge. */
  badgeLabel: string;
  badgeVariant: 'success' | 'neutral' | 'info' | 'warning';
  /** One line: what is true right now. */
  headline: string;
  /** The line under the headline: what to do about it, or why there is nothing to report. */
  detail: string;
  /** Anything else worth saying, after the lead. */
  rest: HostNotice[];
};

export function hostSummary(host: HostBlock): HostSummary {
  if (!host.available) {
    return {
      tone: 'off',
      badgeLabel: 'Not available',
      badgeVariant: 'neutral',
      headline: 'AFCT cannot check this server',
      detail: hostUnavailableMessage(host),
      rest: [],
    };
  }

  const notices = hostNotices(host);
  const lead = notices.find((n) => n.tone === 'warn') ?? notices[0];
  const rest = notices.filter((n) => n !== lead);

  // hostNotices always returns at least the all-clear notice, so the fallbacks below are
  // only there for a future where that stops being true.
  const headline = lead?.title ?? 'Nothing needs doing on the server';
  const detail = lead?.detail ?? 'No restart is pending and no updates are waiting.';

  if (notices.some((n) => n.tone === 'warn')) {
    return {
      tone: 'warn',
      badgeLabel: 'Needs attention',
      badgeVariant: 'warning',
      headline,
      detail,
      rest,
    };
  }
  if (notices.some((n) => n.tone === 'info')) {
    return {
      tone: 'info',
      badgeLabel: 'Updates waiting',
      badgeVariant: 'info',
      headline,
      detail,
      rest,
    };
  }
  return { tone: 'ok', badgeLabel: 'All clear', badgeVariant: 'success', headline, detail, rest };
}
