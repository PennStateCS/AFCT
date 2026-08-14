/**
 * The evaluator's heartbeat: one row per grading slot, touched while it lives.
 *
 * The worker runs one process with several concurrent loops, as many as
 * `submissionMaxConcurrent`, so these are slots rather than machines. Each loop keeps a row
 * saying it is alive and, when it is grading, which submission it holds.
 *
 * This exists because the queue cannot answer the question on its own. You can see what is
 * PROCESSING, but an empty queue looks identical whether the loops are healthy and waiting or
 * dead and silent. The second is how submissions quietly pile up on a production box, and it is
 * precisely the case a status page is for.
 *
 * **Every function here swallows its own errors.** Grading must not fail because the status
 * page lost a heartbeat. A missed beat shows as a stale slot, which is the honest reading.
 */

import { randomUUID } from 'crypto';
import type { WorkerSource } from '@prisma/client';
import { prisma } from '@/lib/prisma';

/**
 * Identifies this run of this process. A restart gets a new one, so rows left behind by a
 * process that died without cleaning up are recognisable as stale rather than looking current.
 */
export const RUN_ID = randomUUID();

let source: WorkerSource = 'APP_PROCESS';

/** Told once at startup: the dedicated container says so, the web app keeps the default. */
export function setWorkerSource(next: WorkerSource): void {
  source = next;
}

/**
 * Heartbeats older than this mean the slot is not reporting.
 *
 * Derived, not picked: an idle loop beats once per cycle and its longest cycle is the top of
 * `IDLE_BACKOFF_MS` in `submission-worker.ts`, currently 30s. Three of those gives a healthy but
 * quiet slot plenty of room while still catching a dead one inside two minutes. **If that
 * backoff grows, this has to grow with it**, or idle slots start reporting as stale.
 */
export const SLOT_STALE_MS = 90_000;

/** How often a busy slot beats while it waits for the evaluator. */
export const SLOT_BEAT_MS = 15_000;

async function quietly(what: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (error) {
    // Deliberately console-only: this is observability, and a failed write here must not
    // reach the activity log or interrupt the loop that called it.
    console.error(`[WorkerSlots] ${what} failed:`, error);
  }
}

/** Announce a slot, or refresh it if this run already claimed that number. */
export async function openSlot(slot: number): Promise<void> {
  await quietly('openSlot', () =>
    prisma.workerSlot.upsert({
      where: { runId_slot: { runId: RUN_ID, slot } },
      create: { runId: RUN_ID, slot, source, lastSeenAt: new Date() },
      update: { lastSeenAt: new Date(), submissionId: null, busySince: null },
    }),
  );
}

/** This slot has claimed a submission and is grading it. */
export async function markSlotBusy(slot: number, submissionId: string): Promise<void> {
  const now = new Date();
  await quietly('markSlotBusy', () =>
    prisma.workerSlot.updateMany({
      where: { runId: RUN_ID, slot },
      data: { lastSeenAt: now, submissionId, busySince: now },
    }),
  );
}

/** Finished, failed, or found nothing: either way the slot is free and still alive. */
export async function markSlotIdle(slot: number): Promise<void> {
  await quietly('markSlotIdle', () =>
    prisma.workerSlot.updateMany({
      where: { runId: RUN_ID, slot },
      data: { lastSeenAt: new Date(), submissionId: null, busySince: null },
    }),
  );
}

/**
 * Still here.
 *
 * Driven per slot, not from one timer for the whole process: a shared timer would keep
 * reporting every slot as healthy while they were all stuck. A busy slot beats on its own
 * interval so a long but legitimate grading job does not read as dead, and a process whose
 * event loop has stopped turning stops beating either way, which is the honest answer.
 */
export async function touchSlot(slot: number): Promise<void> {
  await quietly('touchSlot', () =>
    prisma.workerSlot.updateMany({
      where: { runId: RUN_ID, slot },
      data: { lastSeenAt: new Date() },
    }),
  );
}

/** A loop retiring because concurrency was lowered. */
export async function closeSlot(slot: number): Promise<void> {
  await quietly('closeSlot', () =>
    prisma.workerSlot.deleteMany({ where: { runId: RUN_ID, slot } }),
  );
}

/**
 * Clean shutdown: drop every slot this run owns.
 *
 * Best effort by nature. A process that is killed rather than asked to stop leaves its rows
 * behind, which is why staleness rather than presence is what the page reads.
 */
export async function closeAllSlots(): Promise<void> {
  await quietly('closeAllSlots', () => prisma.workerSlot.deleteMany({ where: { runId: RUN_ID } }));
}
