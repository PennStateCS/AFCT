export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startSubmissionWorker } = await import("./lib/submission-worker");
    startSubmissionWorker();

    const { startActivityLogPruner } = await import("./lib/activity-log-pruner");
    startActivityLogPruner();
  }
}