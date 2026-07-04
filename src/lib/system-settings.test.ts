import { describe, it, expect } from 'vitest';
import * as S from './system-settings';

// Every clamp shares the same contract: non-finite → default, out-of-range →
// nearest bound, in-range → truncated passthrough. Drive them all from one table
// so a new clamp can't slip in without the same guarantees.
const clamps = [
  {
    name: 'session timeout',
    fn: S.clampSessionTimeoutMinutes,
    min: S.MIN_SESSION_TIMEOUT_MINUTES,
    max: S.MAX_SESSION_TIMEOUT_MINUTES,
    def: S.DEFAULT_SESSION_TIMEOUT_MINUTES,
  },
  {
    name: 'upload size',
    fn: S.clampUploadSizeMb,
    min: S.MIN_UPLOAD_SIZE_MB,
    max: S.MAX_UPLOAD_SIZE_MB,
    def: S.DEFAULT_MAX_UPLOAD_SIZE_MB,
  },
  {
    name: 'eval timeout',
    fn: S.clampSubmissionEvalTimeoutMs,
    min: S.MIN_SUBMISSION_EVAL_TIMEOUT_MS,
    max: S.MAX_SUBMISSION_EVAL_TIMEOUT_MS,
    def: S.DEFAULT_SUBMISSION_EVAL_TIMEOUT_MS,
  },
  {
    name: 'eval memory',
    fn: S.clampSubmissionEvalMaxMemoryMb,
    min: S.MIN_SUBMISSION_EVAL_MAX_MEMORY_MB,
    max: S.MAX_SUBMISSION_EVAL_MAX_MEMORY_MB,
    def: S.DEFAULT_SUBMISSION_EVAL_MAX_MEMORY_MB,
  },
  {
    name: 'resubmit cooldown',
    fn: S.clampSubmissionResubmitCooldownMs,
    min: S.MIN_SUBMISSION_RESUBMIT_COOLDOWN_MS,
    max: S.MAX_SUBMISSION_RESUBMIT_COOLDOWN_MS,
    def: S.DEFAULT_SUBMISSION_RESUBMIT_COOLDOWN_MS,
  },
  {
    name: 'max concurrent',
    fn: S.clampSubmissionMaxConcurrent,
    min: S.MIN_SUBMISSION_MAX_CONCURRENT,
    max: S.MAX_SUBMISSION_MAX_CONCURRENT,
    def: S.DEFAULT_SUBMISSION_MAX_CONCURRENT,
  },
  {
    name: 'max attempts',
    fn: S.clampSubmissionMaxAttempts,
    min: S.MIN_SUBMISSION_MAX_ATTEMPTS,
    max: S.MAX_SUBMISSION_MAX_ATTEMPTS,
    def: S.DEFAULT_SUBMISSION_MAX_ATTEMPTS,
  },
  {
    name: 'analyzer limit',
    fn: S.clampSubmissionAnalyzerLimit,
    min: S.MIN_SUBMISSION_ANALYZER_LIMIT,
    max: S.MAX_SUBMISSION_ANALYZER_LIMIT,
    def: S.DEFAULT_SUBMISSION_ANALYZER_LIMIT,
  },
];

describe('system-settings clamps', () => {
  for (const c of clamps) {
    describe(c.name, () => {
      it('returns the default for non-finite input', () => {
        expect(c.fn(Number.NaN)).toBe(c.def);
        expect(c.fn(Number.POSITIVE_INFINITY)).toBe(c.def);
      });

      it('clamps below the minimum up to the floor', () => {
        expect(c.fn(c.min - 1)).toBe(c.min);
      });

      it('clamps above the maximum down to the ceiling', () => {
        expect(c.fn(c.max + 1)).toBe(c.max);
      });

      it('accepts the exact bounds', () => {
        expect(c.fn(c.min)).toBe(c.min);
        expect(c.fn(c.max)).toBe(c.max);
      });

      it('passes an in-range value through, truncating fractions', () => {
        const mid = Math.floor((c.min + c.max) / 2);
        expect(c.fn(mid)).toBe(mid);
        expect(c.fn(mid + 0.9)).toBe(mid);
      });
    });
  }
});
