import { withAdminAuth } from '@/lib/api/with-auth';
import { readStatus, readProgress } from '@/lib/updates';

// fs access + a long-lived stream: force the Node runtime and opt out of caching.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Phases that mean the upgrade has settled; the stream closes when one is reached.
const TERMINAL = new Set(['healthy', 'failed', 'rolled_back']);
const POLL_MS = 1000;
// Hard cap so a forgotten tab can't hold a stream open forever.
const MAX_STREAM_MS = 30 * 60 * 1000;

/**
 * Server-Sent Events stream of an in-flight upgrade: the coarse phase from
 * status.json plus new lines from the updater's progress.log, pushed as they appear
 * so the Updates UI shows real-time progress without polling or a manual refresh.
 * Closes when the upgrade reaches a terminal phase (or after a time cap). System
 * administrators only.
 * @openapi
 * summary: Stream live upgrade progress (Server-Sent Events)
 * responses:
 *   200: { description: "An event stream (text/event-stream) of status + log events." }
 *   403: { description: Caller is not a system administrator. }
 */
export const GET = withAdminAuth(
  (req) => {
    const encoder = new TextEncoder();
    let cursor = 0;
    let timer: ReturnType<typeof setInterval> | undefined;
    const startedAt = Date.now();

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (event: string, data: unknown) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };
        const stop = () => {
          if (timer) clearInterval(timer);
          timer = undefined;
        };

        const tick = () => {
          try {
            const { lines, nextCursor, reset } = readProgress(cursor);
            cursor = nextCursor;
            // `reset` tells the client to replace what it has rather than append: a new run
            // truncated the log, so anything it still shows belongs to the previous one.
            if (lines.length > 0) send('log', { lines, reset });
            const status = readStatus();
            if (status) send('status', status);
            const settled = TERMINAL.has(status?.phase ?? '');
            if (settled || Date.now() - startedAt > MAX_STREAM_MS) {
              send('done', { phase: status?.phase ?? null });
              stop();
              controller.close();
            }
          } catch {
            // A transient read error (e.g. mid-write file) shouldn't kill the stream.
          }
        };

        // Close promptly when the client navigates away.
        req.signal.addEventListener('abort', () => {
          stop();
          try {
            controller.close();
          } catch {
            // already closed
          }
        });

        tick(); // send an immediate first frame
        timer = setInterval(tick, POLL_MS);
      },
      cancel() {
        if (timer) clearInterval(timer);
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        // nginx sits in front of the app; without this it buffers the response and
        // the browser sees nothing until the stream closes.
        'X-Accel-Buffering': 'no',
        Connection: 'keep-alive',
      },
    });
  },
  { deniedAction: 'ADMIN_UPGRADE_VIEW_DENIED' },
);
