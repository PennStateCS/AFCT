'use client';

import InputGroup from '@/components/ui/InputGroup';
import {
  MIN_SUBMISSION_EVAL_TIMEOUT_MS,
  MAX_SUBMISSION_EVAL_TIMEOUT_MS,
  MIN_SUBMISSION_RESUBMIT_COOLDOWN_MS,
  MAX_SUBMISSION_RESUBMIT_COOLDOWN_MS,
  MIN_SUBMISSION_EVAL_MAX_MEMORY_MB,
  MAX_SUBMISSION_EVAL_MAX_MEMORY_MB,
  MIN_SUBMISSION_MAX_CONCURRENT,
  MAX_SUBMISSION_MAX_CONCURRENT,
  MIN_SUBMISSION_MAX_ATTEMPTS,
  MAX_SUBMISSION_MAX_ATTEMPTS,
  MIN_SUBMISSION_ANALYZER_LIMIT,
  MAX_SUBMISSION_ANALYZER_LIMIT,
} from '@/lib/system-settings';
import { msToSec, type FormSnapshot, type SetField } from './system-settings-shared';

/** Evaluator tab: how the autograder evaluates and rate-limits submissions. */
export function EvaluatorTab({
  form,
  setField,
  disabled,
}: {
  form: FormSnapshot;
  setField: SetField;
  disabled: boolean;
}) {
  return (
    <>
      <p className="text-muted-foreground mb-4 text-sm">
        How the autograder evaluates and rate-limits submissions.
      </p>
      <div className="max-w-md space-y-5">
        <InputGroup
          label="Evaluation timeout (seconds)"
          name="evalTimeoutSec"
          type="number"
          required
          requiredMark
          min={msToSec(MIN_SUBMISSION_EVAL_TIMEOUT_MS)}
          max={msToSec(MAX_SUBMISSION_EVAL_TIMEOUT_MS)}
          value={form.evalTimeoutSec === '' ? '' : String(form.evalTimeoutSec)}
          setValue={(val) => setField('evalTimeoutSec', val === '' ? '' : Number(val))}
          disabled={disabled}
          description={`Max time per submission. ${msToSec(MIN_SUBMISSION_EVAL_TIMEOUT_MS)}–${msToSec(MAX_SUBMISSION_EVAL_TIMEOUT_MS)} s.`}
        />
        <InputGroup
          label="Resubmit cooldown (seconds)"
          name="resubmitCooldownSec"
          type="number"
          required
          requiredMark
          min={msToSec(MIN_SUBMISSION_RESUBMIT_COOLDOWN_MS)}
          max={msToSec(MAX_SUBMISSION_RESUBMIT_COOLDOWN_MS)}
          value={form.resubmitCooldownSec === '' ? '' : String(form.resubmitCooldownSec)}
          setValue={(val) => setField('resubmitCooldownSec', val === '' ? '' : Number(val))}
          disabled={disabled}
          description="Wait between resubmits to a problem. 0 disables."
        />
        <InputGroup
          label="Evaluator memory cap (MB)"
          name="evalMaxMemoryMb"
          type="number"
          required
          requiredMark
          min={MIN_SUBMISSION_EVAL_MAX_MEMORY_MB}
          max={MAX_SUBMISSION_EVAL_MAX_MEMORY_MB}
          value={form.evalMaxMemoryMb === '' ? '' : String(form.evalMaxMemoryMb)}
          setValue={(val) => setField('evalMaxMemoryMb', val === '' ? '' : Number(val))}
          disabled={disabled}
          description={`JVM heap per evaluation. ${MIN_SUBMISSION_EVAL_MAX_MEMORY_MB}–${MAX_SUBMISSION_EVAL_MAX_MEMORY_MB} MB.`}
        />
        <InputGroup
          label="Max concurrent evaluations"
          name="maxConcurrent"
          type="number"
          required
          requiredMark
          min={MIN_SUBMISSION_MAX_CONCURRENT}
          max={MAX_SUBMISSION_MAX_CONCURRENT}
          value={form.maxConcurrent === '' ? '' : String(form.maxConcurrent)}
          setValue={(val) => setField('maxConcurrent', val === '' ? '' : Number(val))}
          disabled={disabled}
          description={`Run at once. ${MIN_SUBMISSION_MAX_CONCURRENT}–${MAX_SUBMISSION_MAX_CONCURRENT}. Applies within ~30s.`}
        />
        <InputGroup
          label="Max retry attempts"
          name="maxAttempts"
          type="number"
          required
          requiredMark
          min={MIN_SUBMISSION_MAX_ATTEMPTS}
          max={MAX_SUBMISSION_MAX_ATTEMPTS}
          value={form.maxAttempts === '' ? '' : String(form.maxAttempts)}
          setValue={(val) => setField('maxAttempts', val === '' ? '' : Number(val))}
          disabled={disabled}
          description={`Retries before failing. ${MIN_SUBMISSION_MAX_ATTEMPTS}–${MAX_SUBMISSION_MAX_ATTEMPTS}.`}
        />
        <InputGroup
          label="Analyzer exploration limit"
          name="analyzerLimit"
          type="number"
          required
          requiredMark
          min={MIN_SUBMISSION_ANALYZER_LIMIT}
          max={MAX_SUBMISSION_ANALYZER_LIMIT}
          value={form.analyzerLimit === '' ? '' : String(form.analyzerLimit)}
          setValue={(val) => setField('analyzerLimit', val === '' ? '' : Number(val))}
          disabled={disabled}
          description={`Depth of the cfganalyzer equivalence check. Higher is more thorough but slower. ${MIN_SUBMISSION_ANALYZER_LIMIT}–${MAX_SUBMISSION_ANALYZER_LIMIT}.`}
        />
      </div>
    </>
  );
}
