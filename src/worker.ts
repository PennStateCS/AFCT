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

startSubmissionWorker();

// The worker keeps the event loop alive via its own polling timers. Handle termination
// signals so the container stops promptly on `docker stop` / redeploy; any submission
// left mid-evaluation is recovered by the reaper (reapStuckSubmissions) on next start.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    console.log(`[worker] received ${signal}, shutting down`);
    process.exit(0);
  });
}
