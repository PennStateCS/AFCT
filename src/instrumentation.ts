export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // The submission worker runs the evaluator on untrusted uploads. In the isolated
    // deployment it runs in its own network-jailed container (src/worker.ts) and the app
    // sets RUN_SUBMISSION_WORKER=false so it does NOT start one here. Default-on keeps a
    // single-container deploy working (the app runs the worker in-process as before).
    if (process.env.RUN_SUBMISSION_WORKER !== 'false') {
      const { startSubmissionWorker } = await import('./lib/submission-worker');
      startSubmissionWorker();
    }

    // The pruner (DB-only) and TLS renewal (needs internet egress for ACME + the cert
    // volumes) always stay in the app container, never the internal-only worker.
    const { startActivityLogPruner } = await import('./lib/activity-log-pruner');
    startActivityLogPruner();

    const { startTlsRenewal } = await import('./lib/tls-renewal');
    startTlsRenewal();
  }
}
