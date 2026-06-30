// Configuration for the submission evaluation queue / worker.
//
// Values currently come from environment variables with safe defaults. The
// getter is intentionally centralized and async so the source can later be
// swapped for SystemSettings (admin interface) without touching the worker,
// mirroring getSystemUploadLimit() in upload-limits.ts.

export type EvaluatorConfig = {
  /** Max wall-clock time a single evaluation may run before it is killed (ms). */
  timeoutMs: number;
  /** Max JVM heap for the evaluator process (MB). */
  maxMemoryMb: number;
};

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_MEMORY_MB = 256;

const clamp = (value: number, min: number, max: number, fallback: number): number =>
  Number.isFinite(value) ? Math.max(min, Math.min(max, Math.trunc(value))) : fallback;

export async function getEvaluatorConfig(): Promise<EvaluatorConfig> {
  const timeoutMs = clamp(
    Number(process.env.SUBMISSION_EVAL_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
    1_000, // never less than 1s
    600_000, // never more than 10m
    DEFAULT_TIMEOUT_MS,
  );

  const maxMemoryMb = clamp(
    Number(process.env.SUBMISSION_EVAL_MAX_MEMORY_MB ?? DEFAULT_MAX_MEMORY_MB),
    64, // floor so the JVM can still start
    8_192,
    DEFAULT_MAX_MEMORY_MB,
  );

  return { timeoutMs, maxMemoryMb };
}
