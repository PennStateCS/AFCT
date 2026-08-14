/**
 * Evaluator status for the System Status page, read entirely from the queue.
 *
 * There is no heartbeat and no worker-side state. An earlier version had one, on the argument
 * that an empty queue cannot distinguish a healthy evaluator waiting from a dead one. That is
 * true and it bought less than it cost: a dead evaluator harms nothing until a submission
 * arrives, and the moment one does, the queue says so within a minute. The symptom this page
 * exists to catch, work that stops draining, is itself the detector.
 *
 * So the page reports what it can actually know, and says plainly when it knows nothing. It
 * never claims the evaluator is up on the strength of an empty queue.
 *
 * **Nothing here surfaces a student.** The queue is grade data, so in-flight work reports the
 * kind of problem and how long it has been running, and the submission id for anyone who needs
 * to go and look. No names, no feedback, no evaluator output.
 */

import { prisma } from '@/lib/prisma';
import { getQueueSettings, getEvaluatorConfig } from '@/lib/eval-config';

/**
 * Grace beyond the evaluator's own timeout before work counts as wedged.
 *
 * The same figure the worker's reaper uses to decide a row is stuck, so the page and the reaper
 * cannot disagree about what they are looking at.
 */
const STUCK_GRACE_MS = 60_000;

/** How long a queue may sit undrained before that is worth saying out loud. */
const STALLED_AFTER_MS = 2 * 60_000;

export type WorkItem = {
  submissionId: string;
  /** The kind of problem, never whose it is. */
  problemType: string | null;
  runningForMs: number;
  /** Past the evaluator timeout plus grace: the reaper will return it to the queue. */
  stuck: boolean;
};

export type WorkersStatusResponse = {
  /**
   * working: grading now. stuck: something is past its timeout. stalled: work queued and
   * nothing picking it up. idle: nothing to do, which is NOT a claim that the evaluator is up.
   */
  health: 'working' | 'stuck' | 'stalled' | 'idle';
  /** Concurrent slots the admin configured: SystemSettings.submissionMaxConcurrent. */
  configured: number;
  busy: number;
  inFlight: WorkItem[];
  queue: { pending: number; processing: number; failedLastHour: number };
  /** How long the oldest waiting submission has waited, for the stalled case. */
  oldestPendingMs: number | null;
};

export async function collectWorkers(now = new Date()): Promise<WorkersStatusResponse> {
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  const [settings, evalConfig, processing, oldestPending, pending, failedLastHour] =
    await Promise.all([
      getQueueSettings(),
      getEvaluatorConfig(),
      prisma.submission.findMany({
        where: { status: 'PROCESSING' },
        // Deliberately narrow. Everything else on a submission is the student's.
        select: {
          id: true,
          updatedAt: true,
          assignmentProblem: { select: { problem: { select: { type: true } } } },
        },
        orderBy: { updatedAt: 'asc' },
      }),
      prisma.submission.findFirst({
        where: { status: 'PENDING' },
        select: { submittedAt: true },
        orderBy: { submittedAt: 'asc' },
      }),
      prisma.submission.count({ where: { status: 'PENDING' } }),
      prisma.submission.count({ where: { status: 'FAILED', updatedAt: { gte: hourAgo } } }),
    ]);

  // Claiming a submission sets it PROCESSING and stamps updatedAt, so that is when the work
  // started. The same reading the reaper takes.
  const stuckBefore = now.getTime() - (evalConfig.timeoutMs + STUCK_GRACE_MS);
  const inFlight: WorkItem[] = processing.map((s) => ({
    submissionId: s.id,
    problemType: s.assignmentProblem?.problem?.type ?? null,
    runningForMs: now.getTime() - s.updatedAt.getTime(),
    stuck: s.updatedAt.getTime() < stuckBefore,
  }));

  const oldestPendingMs = oldestPending
    ? now.getTime() - oldestPending.submittedAt.getTime()
    : null;

  const health: WorkersStatusResponse['health'] = inFlight.some((w) => w.stuck)
    ? 'stuck'
    : inFlight.length > 0
      ? 'working'
      : // Nothing being graded. Work waiting and waiting a while means nothing is collecting it,
        // which is as close to "the evaluator is down" as the queue can honestly get.
        pending > 0 && (oldestPendingMs ?? 0) > STALLED_AFTER_MS
        ? 'stalled'
        : 'idle';

  return {
    health,
    configured: settings.maxConcurrent,
    busy: inFlight.length,
    inFlight,
    queue: { pending, processing: inFlight.length, failedLastHour },
    oldestPendingMs,
  };
}
