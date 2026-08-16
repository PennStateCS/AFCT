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

    /**
     * Say so at startup when there is no secret-encryption key.
     *
     * Without one, AFCT starts, serves, and looks entirely healthy, and then refuses the first
     * thing an administrator saves that has to be stored encrypted: a mail password, an OIDC
     * client secret, an LTI registration. The error they get tells them to restore a value they
     * have never seen. A real deployment lost an evening to that, and every part of it was
     * invisible until somebody happened to save a setting.
     *
     * A warning rather than a refusal to start. The site is genuinely usable without the key,
     * courses, assignments and submissions do not touch it, and taking AFCT offline over a
     * setting nobody may be about to change would be the worse failure.
     */
    const { hasSecretKey, SECRET_KEY_ENV } = await import('./lib/secret-encryption');
    if (!hasSecretKey()) {
      console.warn(
        `[afct] ${SECRET_KEY_ENV} is not set. AFCT will run, but no setting that is stored ` +
          'encrypted can be saved: mail credentials, institutional sign-in, LMS registrations. ' +
          'The installer and the in-app updater both add one; on an older deployment, run an ' +
          'update or add it to the environment file and restart.',
      );
    }

    // The pruner (DB-only) and TLS renewal (needs internet egress for ACME + the cert
    // volumes) always stay in the app container, never the internal-only worker.
    const { startActivityLogPruner } = await import('./lib/activity-log-pruner');
    startActivityLogPruner();

    const { startTlsRenewal } = await import('./lib/tls-renewal');
    startTlsRenewal();

    // Grade passback also needs egress, so it belongs here rather than in the worker.
    const { startScoreSender } = await import('./lib/lti/score-sender');
    startScoreSender();
    const { startMailSender } = await import('./lib/mail-sender');
    startMailSender();

    // Trial uploads are removed here, not in the worker: the worker mounts the uploads
    // volume read-only, and that is worth keeping.
    const { startEvaluatorTrialJanitor } = await import('./lib/evaluator-trials');
    startEvaluatorTrialJanitor();
  }
}
