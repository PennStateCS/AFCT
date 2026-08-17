import { errMessage } from '@/lib/errors';

/**
 * Record a best-effort probe that did not work.
 *
 * The status collectors are deliberately tolerant: they ask the database, the filesystem and the
 * cgroup interface a lot of optional questions, and any one of them not answering should never
 * take the whole page down. That part is right. What was wrong is that the error was thrown away
 * entirely, so a probe that failed and a probe that found nothing produced the same empty value,
 * on screen and in the logs alike.
 *
 * That distinction is the difference between "this deployment has no container limits" and "the
 * cgroup files could not be read", or between "no slow queries" and "the statistics extension is
 * not installed". Both readings are plausible to somebody looking at a blank field in an
 * incident, and only one of them is actionable.
 *
 * So the value still degrades quietly, exactly as before, and the reason now goes to the server
 * log where somebody investigating can find it. Nothing here is shown to a user: a probe failing
 * is an operational detail, not something to put on an administrator's screen.
 */
export function probeFailed(label: string, err: unknown): void {
  console.warn(`[status] ${label}: ${errMessage(err)}`);
}
