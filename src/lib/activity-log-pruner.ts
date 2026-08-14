import { prisma } from '@/lib/prisma';
import { purgeExpiredSingleUseTokens } from '@/lib/single-use-token';
import { purgeExpiredLaunches } from '@/lib/lti/launch-transaction';
import { purgeExpiredPendingLinks } from '@/lib/lti/course-link';
import { purgeSentMail } from '@/lib/mail-queue';
import {
  DEFAULT_ACTIVITY_LOG_RETENTION_DAYS,
  clampActivityLogRetentionDays,
} from '@/lib/system-settings';

const DAY_MS = 24 * 60 * 60 * 1000;
const PRUNE_INTERVAL_MS = DAY_MS; // once a day

let started = false;

// Admin-configured retention (clamped), falling back to the default if the
// settings row can't be read.
async function getRetentionDays(): Promise<number> {
  try {
    const s = await prisma.systemSettings.findUnique({
      where: { id: 1 },
      select: { activityLogRetentionDays: true },
    });
    return clampActivityLogRetentionDays(
      Number(s?.activityLogRetentionDays ?? DEFAULT_ACTIVITY_LOG_RETENTION_DAYS),
    );
  } catch {
    return DEFAULT_ACTIVITY_LOG_RETENTION_DAYS;
  }
}

// Delete audit-log rows older than the retention window.
async function pruneOnce(): Promise<void> {
  try {
    const days = await getRetentionDays();
    const cutoff = new Date(Date.now() - days * DAY_MS);
    const { count } = await prisma.activityLog.deleteMany({
      where: { timestamp: { lt: cutoff } },
    });
    if (count > 0) {
      console.log(`[activity-log-pruner] deleted ${count} rows older than ${days}d`);
    }
  } catch (error) {
    console.error('[activity-log-pruner] prune failed:', error);
  }
}

// Expired password-reset links and the like. Sharing this daily pass rather than starting a
// second timer: both are retention chores on the same schedule, and one loop is one thing to
// reason about. Failures are logged and swallowed, because a sweep that cannot run must never
// stop the one beside it.
async function purgeTokensOnce(): Promise<void> {
  try {
    const count = await purgeExpiredSingleUseTokens();
    if (count > 0) {
      console.log(`[single-use-token] deleted ${count} expired tokens`);
    }
  } catch (error) {
    console.error('[single-use-token] purge failed:', error);
  }

  // Spent and abandoned launches, on the same schedule and the same swallow-and-continue rule.
  try {
    const count = await purgeExpiredLaunches();
    if (count > 0) {
      console.log(`[lti] deleted ${count} finished launches`);
    }
  } catch (error) {
    console.error('[lti] launch purge failed:', error);
  }
}

// Launches from an unlinked LMS course where nobody chose a course. Same daily pass and the
// same swallow-and-continue rule as the sweeps above.
async function purgePendingLinksOnce(): Promise<void> {
  try {
    const count = await purgeExpiredPendingLinks();
    if (count > 0) {
      console.log(`[lti] deleted ${count} expired pending course links`);
    }
  } catch (error) {
    console.error('[lti] pending-link purge failed:', error);
  }
}

/**
 * Messages that have been sent, or given up on.
 *
 * Their bodies are already cleared when they finish, so what is left is small; the reason to
 * sweep them is that nothing else ever would, and an unbounded table on a box where disk is the
 * binding constraint is a slow leak rather than no problem. A week is long enough to answer
 * "did my reset email go out last Tuesday" and short enough that the table stays flat.
 *
 * Same daily pass and the same swallow-and-continue rule as the sweeps above.
 */
async function purgeSentMailOnce(): Promise<void> {
  try {
    const count = await purgeSentMail();
    if (count > 0) {
      console.log(`[mail] deleted ${count} finished messages`);
    }
  } catch (error) {
    console.error('[mail] purge failed:', error);
  }
}

/**
 * One daily pass: every sweep, in order, none of them able to stop another.
 *
 * Separate from `loop` so a test can prove a sweep is actually *in* the pass. Testing each one
 * on its own says only that it works when called, which is no help against the failure that
 * matters here: a sweep that exists and is never reached. `purgeSentMail` sat written and
 * uncalled for exactly that reason.
 */
async function runOnce(): Promise<void> {
  await pruneOnce();
  await purgeTokensOnce();
  await purgePendingLinksOnce();
  await purgeSentMailOnce();
}

async function loop(): Promise<void> {
  await runOnce();
  setTimeout(() => void loop(), PRUNE_INTERVAL_MS);
}

// Prune on startup, then daily. Safe to call more than once.
export function startActivityLogPruner(): void {
  if (started) return;
  started = true;
  void loop();
}

// Exposed for unit tests only.
export const __test__ = { pruneOnce, purgeTokensOnce, purgeSentMailOnce, runOnce, getRetentionDays };
