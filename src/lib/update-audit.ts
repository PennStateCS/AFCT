import type { PrismaClient } from '@prisma/client';
import { createEnhancedActivityLog, type LogSeverity } from '@/lib/activity-log-utils';
import {
  readStatus,
  readProgressTail,
  readLoggedStatusRequestId,
  markStatusLogged,
} from '@/lib/updates';

// Terminal phases the updater settles a run at (see docker/updater/updater.sh).
const TERMINAL = new Set(['healthy', 'failed', 'rolled_back']);

// Map a terminal phase to the activity-log action and severity to record. An upgrade,
// downgrade, or self-update all end at one of these, so a single mapping covers them.
function outcomeFor(phase: string): { action: string; severity: LogSeverity } | null {
  switch (phase) {
    case 'healthy':
      return { action: 'SYSTEM_UPDATE_COMPLETED', severity: 'INFO' };
    case 'rolled_back':
      return { action: 'SYSTEM_UPDATE_ROLLED_BACK', severity: 'WARNING' };
    case 'failed':
      return { action: 'SYSTEM_UPDATE_FAILED', severity: 'ERROR' };
    default:
      return null;
  }
}

/**
 * Writes a copy of a finished update run's outcome to the activity log so it can be
 * reviewed later in System Logs, even after status.json is overwritten by the next
 * run. Reconciled from a status poll rather than the updater (which has no DB access):
 * the app calls this whenever it reads the status, and a marker file keeps each run
 * logged exactly once no matter how many admins poll.
 *
 * Never throws: a logging failure must not break the status read it rides along with.
 */
export async function reconcileUpdateOutcomeLog(
  prisma: PrismaClient,
  reqOrContext: Request | { ipAddress?: string | null; userAgent?: string | null },
): Promise<void> {
  try {
    const status = readStatus();
    const phase = status?.phase;
    const requestId = status?.requestId;
    if (!phase || !requestId || !TERMINAL.has(phase)) return;
    if (readLoggedStatusRequestId() === requestId) return;
    const outcome = outcomeFor(phase);
    if (!outcome) return;

    // Attribute the outcome to whoever requested the run (recorded at request time by
    // the *_REQUESTED log), falling back to a system entry if that can't be found.
    let userId: string | null = null;
    try {
      const requestLog = await prisma.activityLog.findFirst({
        where: { metadata: { path: ['requestId'], equals: requestId } },
        orderBy: { timestamp: 'desc' },
        select: { userId: true },
      });
      userId = requestLog?.userId ?? null;
    } catch {
      // fall back to a system-actor entry
    }

    await createEnhancedActivityLog(prisma, reqOrContext, {
      userId,
      action: outcome.action,
      severity: outcome.severity,
      category: 'SYSTEM',
      metadata: {
        requestId,
        phase,
        fromTag: status?.fromTag ?? null,
        toTag: status?.toTag ?? null,
        message: status?.message ?? null,
        // A snapshot of the tail of the run's live log, for after-the-fact diagnosis.
        progressTail: readProgressTail(40),
      },
    });

    // Mark only after the log is written, so a failed write is retried on the next
    // poll rather than silently skipped. Worst case is a rare duplicate outcome entry
    // if two polls race, which is preferable to losing the record entirely.
    markStatusLogged(requestId);
  } catch {
    // Best-effort: never let outcome logging disrupt the status read.
  }
}
