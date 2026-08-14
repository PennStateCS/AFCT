/**
 * Evaluator slot health for the System Status page.
 *
 * Two questions, and the second is the one that needs the heartbeat: how much work is waiting,
 * and are the loops that should be doing it actually alive. A queue-derived answer alone is
 * reassuring exactly when it should not be, because an empty queue looks the same whether the
 * loops are healthy and waiting or dead and silent.
 *
 * **Nothing here surfaces a student.** The queue is grade data, so a slot reports the kind of
 * work it is doing and how long it has been doing it, and the submission id for anyone who needs
 * to go and look. No names, no feedback, no evaluator output.
 */

import { prisma } from '@/lib/prisma';
import { SLOT_STALE_MS } from '@/lib/worker-slots';
import { getQueueSettings } from '@/lib/eval-config';
import type { WorkerSource } from '@prisma/client';

export type SlotState = 'grading' | 'waiting' | 'stale';

export type WorkerSlotItem = {
  /** Display position, 1..N in the order the slots started. */
  position: number;
  state: SlotState;
  source: WorkerSource;
  startedAt: string;
  lastSeenAt: string;
  /** Set only while grading. The problem type, never the student. */
  problemType: string | null;
  submissionId: string | null;
  busySinceMs: number | null;
};

export type WorkersStatusResponse = {
  /** healthy: every configured slot reporting. degraded: some missing or stale. down: none. */
  health: 'healthy' | 'degraded' | 'down';
  /** What the admin set: SystemSettings.submissionMaxConcurrent. */
  configured: number;
  live: number;
  grading: number;
  slots: WorkerSlotItem[];
  queue: { pending: number; processing: number; failedLastHour: number };
  /** True when the queue has work and nothing is reporting: the case worth an alert. */
  backlogWithNoWorkers: boolean;
};

export async function collectWorkers(now = new Date()): Promise<WorkersStatusResponse> {
  const staleBefore = new Date(now.getTime() - SLOT_STALE_MS);
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  const [settings, rows, pending, processing, failedLastHour] = await Promise.all([
    getQueueSettings(),
    prisma.workerSlot.findMany({ orderBy: { startedAt: 'asc' } }),
    prisma.submission.count({ where: { status: 'PENDING' } }),
    prisma.submission.count({ where: { status: 'PROCESSING' } }),
    prisma.submission.count({ where: { status: 'FAILED', updatedAt: { gte: hourAgo } } }),
  ]);

  // The problem type for whatever is being graded, in one query rather than one per slot.
  const busyIds = rows.map((r) => r.submissionId).filter((id): id is string => id !== null);
  const problemTypes = new Map<string, string | null>();
  if (busyIds.length > 0) {
    const subs = await prisma.submission.findMany({
      where: { id: { in: busyIds } },
      // Deliberately narrow. Everything else on a submission is the student's.
      select: { id: true, assignmentProblem: { select: { problem: { select: { type: true } } } } },
    });
    for (const s of subs) problemTypes.set(s.id, s.assignmentProblem?.problem?.type ?? null);
  }

  const slots: WorkerSlotItem[] = rows.map((row, i) => {
    const stale = row.lastSeenAt < staleBefore;
    return {
      position: i + 1,
      // A stale row may still name a submission; the state says not to believe it.
      state: stale ? 'stale' : row.submissionId ? 'grading' : 'waiting',
      source: row.source,
      startedAt: row.startedAt.toISOString(),
      lastSeenAt: row.lastSeenAt.toISOString(),
      problemType: row.submissionId ? (problemTypes.get(row.submissionId) ?? null) : null,
      submissionId: row.submissionId,
      busySinceMs: row.busySince ? now.getTime() - row.busySince.getTime() : null,
    };
  });

  const live = slots.filter((s) => s.state !== 'stale').length;
  const grading = slots.filter((s) => s.state === 'grading').length;
  const configured = settings.maxConcurrent;

  // Down means nothing is reporting at all, whatever rows are lying around. Degraded covers both
  // "fewer than configured" and "some went quiet", which read the same to an operator: the
  // evaluator is not at full strength and somebody should look.
  const health = live === 0 ? 'down' : live < configured ? 'degraded' : 'healthy';

  return {
    health,
    configured,
    live,
    grading,
    slots,
    queue: { pending, processing, failedLastHour },
    backlogWithNoWorkers: live === 0 && pending > 0,
  };
}
