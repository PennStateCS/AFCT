import { beforeEach, describe, expect, it, vi } from 'vitest';

const executeMock = vi.hoisted(() => vi.fn());

vi.mock('../../lib/java-runner', () => ({
  default: class {
    execute = executeMock;
  },
}));

import { buildEvaluatorArgs, runEvaluatorJar } from '@/lib/evaluator-runner';

const CONFIG = { timeoutMs: 5_000, maxMemoryMb: 256, analyzerLimit: 100 };

const run = (problem: { type: string | null; maxStates?: number | null; isDeterministic?: boolean | null }) =>
  runEvaluatorJar({
    answerFilePath: '/private/uploads/solutions/answer.jff',
    uploadedFilePath: '/private/uploads/submissions/upload.jff',
    config: CONFIG,
    problem,
  });

describe('buildEvaluatorArgs', () => {
  it('passes nothing extra for problem types without a state bound', () => {
    expect(buildEvaluatorArgs({ type: 'CFG' })).toEqual([]);
    expect(buildEvaluatorArgs({ type: null })).toEqual([]);
  });

  it('passes the state bound for PDA, and the determinism flag as well for FA', () => {
    expect(buildEvaluatorArgs({ type: 'PDA', maxStates: 8 })).toEqual(['8']);
    expect(buildEvaluatorArgs({ type: 'FA', maxStates: 5, isDeterministic: true })).toEqual([
      '5',
      'true',
    ]);
  });

  it('falls back to -1 states and non-deterministic when unset', () => {
    expect(buildEvaluatorArgs({ type: 'FA' })).toEqual(['-1', 'false']);
  });
});

describe('runEvaluatorJar', () => {
  beforeEach(() => {
    executeMock.mockReset();
  });

  it('runs the jar with the configured limits and returns the parsed verdict', async () => {
    executeMock.mockResolvedValue({
      stdout: '  {"correct":true,"feedback":"Accepted"}  ',
      stderr: '',
    });

    const result = await run({ type: 'FA', maxStates: 5, isDeterministic: false });

    expect(executeMock).toHaveBeenCalledWith(
      [
        '--json',
        '/private/uploads/solutions/answer.jff',
        '/private/uploads/submissions/upload.jff',
        '5',
        'false',
      ],
      {
        timeout: 5_000,
        maxMemoryMb: 256,
        env: {
          CFGANALYZER_LIMIT: '100',
          TIMEOUT_SECONDS: '5',
          UPGRADED_FEEDBACK: 'true',
        },
      },
    );
    expect(result).toMatchObject({
      outcome: 'ok',
      correct: true,
      feedback: 'Accepted',
      evaluation: { correct: true, feedback: 'Accepted' },
      stdout: '{"correct":true,"feedback":"Accepted"}',
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('keeps stderr alongside a good verdict rather than treating it as a failure', async () => {
    executeMock.mockResolvedValue({ stdout: '{"correct":false}', stderr: ' noisy warning ' });

    const result = await run({ type: 'CFG' });

    expect(result.outcome).toBe('ok');
    expect(result.stderr).toBe('noisy warning');
  });

  it('substitutes a readable sentence when the jar returns a Java Stream toString', async () => {
    executeMock.mockResolvedValue({
      stdout: '{"correct":false,"feedback":"java.lang.Object$Stream@1a2b3c"}',
      stderr: '',
    });

    const result = await run({ type: 'CFG' });

    expect(result).toMatchObject({ outcome: 'ok', feedback: 'Evaluation completed - correct: false' });
  });

  it('leaves correct undefined when the verdict is not a boolean', async () => {
    executeMock.mockResolvedValue({ stdout: '{"correct":"yes"}', stderr: '' });

    const result = await run({ type: 'CFG' });

    expect(result).toMatchObject({ outcome: 'ok', feedback: 'Evaluation completed - correct: undefined' });
    expect(result.outcome === 'ok' && result.correct).toBeUndefined();
  });

  it('reports unparsable output, keeping what the jar printed', async () => {
    executeMock.mockResolvedValue({ stdout: 'Exception in thread "main"', stderr: '' });

    const result = await run({ type: 'CFG' });

    expect(result.outcome).toBe('unparsable');
    expect(result.stdout).toBe('Exception in thread "main"');
  });

  it('treats empty output as unparsable', async () => {
    executeMock.mockResolvedValue({ stdout: '', stderr: '' });

    expect((await run({ type: 'CFG' })).outcome).toBe('unparsable');
  });

  it('reports JSON that is not an object separately from unparsable output', async () => {
    executeMock.mockResolvedValue({ stdout: 'null', stderr: '' });

    const result = await run({ type: 'CFG' });

    expect(result).toMatchObject({ outcome: 'invalid-json', evaluation: null });
  });

  it('returns an error outcome instead of throwing when the jar cannot run', async () => {
    executeMock.mockRejectedValue(new Error('Evaluation timed out'));

    const result = await run({ type: 'CFG' });

    expect(result).toMatchObject({ outcome: 'error', error: 'Evaluation timed out', stdout: '', stderr: '' });
  });

  it('gives the jar at least one second of early-stopping budget', async () => {
    executeMock.mockResolvedValue({ stdout: '{"correct":true}', stderr: '' });

    await runEvaluatorJar({
      answerFilePath: 'a',
      uploadedFilePath: 'b',
      config: { timeoutMs: 200, maxMemoryMb: 256, analyzerLimit: 10 },
      problem: { type: 'CFG' },
    });

    expect(executeMock.mock.calls[0][1].env.TIMEOUT_SECONDS).toBe('1');
  });
});
