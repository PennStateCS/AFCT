import { prisma } from '@/lib/prisma';
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

async function loop(): Promise<void> {
  await pruneOnce();
  setTimeout(() => void loop(), PRUNE_INTERVAL_MS);
}

// Prune on startup, then daily. Safe to call more than once.
export function startActivityLogPruner(): void {
  if (started) return;
  started = true;
  void loop();
}

// Exposed for unit tests only.
export const __test__ = { pruneOnce, getRetentionDays };
