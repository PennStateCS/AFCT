import { statusGet } from '@/lib/api/status-route';
import { collectWorkers } from '@/lib/status/workers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Wrapped rather than passed directly: collectWorkers takes an injectable clock for tests,
// and statusGet hands its collector a Request.
/**
 * Workers tab: the evaluator's grading slots, their health, and what each is working on.
 *
 * Slots rather than machines: the worker runs one process with as many concurrent loops as
 * `submissionMaxConcurrent`. Reports the problem type and elapsed time for work in flight, never
 * the student, so an operational page does not become somewhere grade data leaks out.
 * @openapi
 * summary: Evaluator worker status
 * responses:
 *   200: { description: "Slot health, what each slot is grading, and queue depth." }
 *   401: { description: Not signed in. }
 *   403: { description: Not a system administrator. }
 */
export const GET = statusGet(() => collectWorkers());
