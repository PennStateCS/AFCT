// Standalone entrypoint for the submission-evaluation worker.
//
// The worker normally starts in-process from instrumentation.ts (the web app), but in
// production it runs HERE instead, as its own process in a dedicated, network-isolated
// container (the `worker` service in deploy/docker-compose.yml). That container is on the
// internal `backend` network ONLY: it can reach Postgres to record grades but has NO
// internet egress, so a hostile student submission run through the Java/cfganalyzer
// subprocess cannot exfiltrate data or probe internal services. The web `app` container
// sets RUN_SUBMISSION_WORKER=false so it no longer starts the worker, leaving grading
// solely to this process.
//
// Run with: `npx tsx src/worker.ts` (tsx is a production dependency and resolves the
// `@/*` path alias from tsconfig.json).
import { startSubmissionWorker } from '@/lib/submission-worker';
import { closeAllSlots, setWorkerSource } from '@/lib/worker-slots';

// Say which process this is before any slot row is written, so the status page can tell the
// dedicated container apart from a development app process running the same loops.
setWorkerSource('WORKER_CONTAINER');

startSubmissionWorker();

// The worker keeps the event loop alive via its own polling timers. Handle termination
// signals so the container stops promptly on `docker stop` / redeploy; any submission
// left mid-evaluation is recovered by the reaper (reapStuckSubmissions) on next start.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    console.log(`[worker] received ${signal}, shutting down`);
    // Drop this run's slot rows on the way out so the status page shows the worker gone
    // immediately rather than waiting for the heartbeats to age out. Bounded: a stop must not
    // hang on the database, and stale rows are handled anyway.
    void Promise.race([closeAllSlots(), new Promise((r) => setTimeout(r, 2_000))]).finally(() =>
      process.exit(0),
    );
  });
}
