// Staff evaluator trials: the shared rules about where the uploads live, how long a
// result survives, and how many trials may run at once.
//
// Imported by the API routes (which write the uploads and read results back) and by the
// submission worker (which claims and runs them), so anything both sides must agree on
// belongs here rather than being restated in each.

import fs from 'fs';
import path from 'path';
import { prisma } from '@/lib/prisma';
import { safeUnlinkInDir, resolveInsideDir } from '@/lib/safe-upload';
import { errMessage } from '@/lib/errors';

/** Where trial uploads are written. Deliberately not the submissions directory. */
export const TRIALS_DIR = path.join('/private', 'uploads', 'trials');

/**
 * How long a finished trial survives before it is deleted, row and all.
 *
 * Short on purpose. The file that went in is usually a real student's work, re-run to
 * reproduce a grading complaint, so a trial must never become a lasting second copy of
 * somebody's submission outside the access controls around the real one.
 */
export const TRIAL_RESULT_TTL_MS = 60 * 60 * 1000;

/**
 * The most trials that may be running at once, across everyone.
 *
 * Trials are claimed ahead of pending submissions, so without a ceiling a handful of
 * staff could hold every worker loop and stall real grading. The effective cap is also
 * bounded by the configured worker count: with a single loop a trial has to be allowed
 * to use it, or trials would never run at all.
 */
export const TRIAL_MAX_CONCURRENT = 2;

export function trialConcurrencyLimit(workerLoops: number): number {
  return Math.max(1, Math.min(TRIAL_MAX_CONCURRENT, workerLoops - 1));
}

/** When a trial created now should be removed. */
export function trialExpiresAt(from: Date = new Date()): Date {
  return new Date(from.getTime() + TRIAL_RESULT_TTL_MS);
}

/**
 * Delete a trial's uploaded files and forget their names.
 *
 * Runs in the app container, which is the only one with write access to the uploads
 * volume (the worker mounts it read-only, and keeping it that way is the point of
 * running the evaluator in a jailed container). Clearing the columns is what tells the
 * orphan sweep below there is nothing left to remove for this row.
 */
export async function deleteTrialInputs(trial: {
  id: string;
  answerFileName: string | null;
  submissionFileName: string | null;
}): Promise<void> {
  if (!trial.answerFileName && !trial.submissionFileName) return;
  for (const name of [trial.answerFileName, trial.submissionFileName]) {
    if (name) await safeUnlinkInDir(TRIALS_DIR, name);
  }
  await prisma.evaluatorTrial.updateMany({
    where: { id: trial.id },
    data: { answerFileName: null, submissionFileName: null },
  });
}

/** Delete every trial past its expiry, uploads first. Returns how many rows went. */
export async function pruneExpiredTrials(now: Date = new Date()): Promise<number> {
  const expired = await prisma.evaluatorTrial.findMany({
    where: { expiresAt: { lt: now } },
    select: { id: true, answerFileName: true, submissionFileName: true },
  });
  for (const trial of expired) {
    await deleteTrialInputs(trial);
  }
  const removed = await prisma.evaluatorTrial.deleteMany({ where: { expiresAt: { lt: now } } });
  return removed.count;
}

/**
 * Files in the trials directory that no row claims. A worker killed mid-run leaves the
 * pair behind, and nothing else would ever remove them.
 *
 * The grace period matters: the API writes both files before it creates the row, so a
 * file that is seconds old may simply be waiting for its row and must be left alone.
 */
const ORPHAN_GRACE_MS = 10 * 60 * 1000;

export async function sweepOrphanTrialFiles(now: Date = new Date()): Promise<number> {
  let names: string[];
  try {
    names = await fs.promises.readdir(TRIALS_DIR);
  } catch {
    return 0; // nothing has been uploaded yet, so there is no directory
  }
  if (names.length === 0) return 0;

  const referenced = new Set<string>();
  const rows = await prisma.evaluatorTrial.findMany({
    select: { answerFileName: true, submissionFileName: true },
  });
  for (const row of rows) {
    if (row.answerFileName) referenced.add(row.answerFileName);
    if (row.submissionFileName) referenced.add(row.submissionFileName);
  }

  let removed = 0;
  for (const name of names) {
    if (referenced.has(name)) continue;
    try {
      const full = resolveInsideDir(TRIALS_DIR, name);
      const stat = await fs.promises.stat(full);
      if (now.getTime() - stat.mtimeMs < ORPHAN_GRACE_MS) continue;
      await fs.promises.unlink(full);
      removed++;
    } catch {
      // Best effort: a file we cannot stat or remove is not worth failing the sweep for.
    }
  }
  return removed;
}

const JANITOR_INTERVAL_MS = 5 * 60 * 1000;

// Same singleton guard as the submission worker: under `next dev` this module is
// re-evaluated on every recompile, and a module-level flag would let a second interval
// start each time.
const janitorFlags = globalThis as unknown as { __evaluatorTrialJanitorStarted?: boolean };

/**
 * Start the periodic cleanup. Belongs in the app container: it writes to the uploads
 * volume, which the worker cannot. Finished trials normally have their files removed as
 * soon as the page reads the result; this is the backstop for the runs nobody comes back
 * to look at.
 */
export function startEvaluatorTrialJanitor(): void {
  if (janitorFlags.__evaluatorTrialJanitorStarted) return;
  janitorFlags.__evaluatorTrialJanitorStarted = true;

  const sweep = async () => {
    try {
      const rows = await pruneExpiredTrials();
      const files = await sweepOrphanTrialFiles();
      if (rows > 0 || files > 0) {
        console.log(`[EvaluatorTrials] Removed ${rows} expired trial(s) and ${files} stray file(s)`);
      }
    } catch (error) {
      console.error('[EvaluatorTrials] Cleanup error:', errMessage(error));
    }
  };

  setInterval(() => void sweep(), JANITOR_INTERVAL_MS).unref?.();
  void sweep();
}
