import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---- Hoisted mocks for every side-effecting dependency of the worker ----
const prismaMock = vi.hoisted(() => ({
  submission: {
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  assignmentProblemGrade: { upsert: vi.fn() },
}));
const executeMock = vi.hoisted(() => vi.fn());
const getEvaluatorConfigMock = vi.hoisted(() => vi.fn());
const getQueueSettingsMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());
const existsSyncMock = vi.hoisted(() => vi.fn());
const execSyncMock = vi.hoisted(() => vi.fn());
const platformMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('../../lib/java-runner', () => ({
  default: class {
    execute = executeMock;
  },
}));
vi.mock('./eval-config', () => ({
  getEvaluatorConfig: getEvaluatorConfigMock,
  getQueueSettings: getQueueSettingsMock,
}));
vi.mock('./activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
vi.mock('fs', () => ({ default: { existsSync: existsSyncMock }, existsSync: existsSyncMock }));
vi.mock('child_process', () => ({ execSync: execSyncMock }));
vi.mock('os', () => ({ default: { platform: platformMock }, platform: platformMock }));

import { __test__ } from '@/lib/submission-worker';

const { evaluateSubmission, runJavaEvaluator, reapStuckSubmissions, runWorkerLoop } = __test__;

const CONFIG = { timeoutMs: 5_000, maxMemoryMb: 256, analyzerLimit: 100 };

const makeSubmission = (over: Record<string, any> = {}): any => ({
  id: 'sub-1',
  studentId: 'stu-1',
  courseId: 'course-1',
  assignmentId: 'a-1',
  problemId: 'p-1',
  fileName: 'submission.txt',
  attempts: 0,
  status: 'PROCESSING',
  assignmentProblem: {
    assignmentId: 'a-1',
    problemId: 'p-1',
    maxPoints: 10,
    autograderEnabled: true,
    problem: { fileName: 'answer.txt', type: 'CFG', maxStates: null, isDeterministic: null },
  },
  ...over,
});

// Which activity-log actions were emitted (2nd positional arg of the log payload).
const loggedActions = () =>
  activityLogMock.mock.calls.map((c) => (c[2] as { action: string }).action);

beforeEach(() => {
  vi.clearAllMocks();
  platformMock.mockReturnValue('linux');
  existsSyncMock.mockReturnValue(true);
  executeMock.mockResolvedValue({ stdout: '{"correct":true,"feedback":"ok"}', stderr: '' });
  activityLogMock.mockResolvedValue(undefined);
  getEvaluatorConfigMock.mockResolvedValue(CONFIG);
  delete process.env.CFGANALYZER_BINARY;
});

describe('runJavaEvaluator — guard branches', () => {
  it('fails immediately when no file was submitted', async () => {
    const result = await runJavaEvaluator(makeSubmission({ fileName: null }), CONFIG);
    expect(result).toMatchObject({ status: 'FAILED', correct: false, feedback: 'No file submitted.' });
    expect(loggedActions()).toContain('SUBMISSION_EVALUATION_ERROR');
  });

  it('fails when the uploaded file is missing on disk', async () => {
    existsSyncMock.mockReturnValue(false);
    const result = await runJavaEvaluator(makeSubmission(), CONFIG);
    expect(result.status).toBe('FAILED');
    expect(result.feedback).toBe('ERROR: Uploaded file not found.');
  });

  it('fails when the problem has no configured answer file', async () => {
    const submission = makeSubmission();
    submission.assignmentProblem.problem.fileName = null;
    const result = await runJavaEvaluator(submission, CONFIG);
    expect(result.status).toBe('FAILED');
    expect(result.feedback).toBe('ERROR: No answer file configured for this problem.');
  });

  it('fails when the answer file is missing on the server', async () => {
    // Uploaded file exists, answer file does not.
    existsSyncMock.mockImplementation((p: string) => p.includes('submissions'));
    const result = await runJavaEvaluator(makeSubmission(), CONFIG);
    expect(result.status).toBe('FAILED');
    expect(result.feedback).toBe('ERROR: Answer file not found on server.');
  });
});

describe('runJavaEvaluator — Windows local dev path', () => {
  it('counts lines with PowerShell instead of running the JAR', async () => {
    platformMock.mockReturnValue('win32');
    execSyncMock.mockReturnValue('  7 \n');
    const result = await runJavaEvaluator(makeSubmission(), CONFIG);
    expect(result).toMatchObject({ status: 'COMPLETED', feedback: 'File has 7 lines (Windows).' });
    expect(executeMock).not.toHaveBeenCalled();
  });
});

describe('runJavaEvaluator — evaluator execution', () => {
  it('parses a successful evaluation and reports correctness + feedback', async () => {
    executeMock.mockResolvedValue({ stdout: '{"correct":true,"feedback":"Nice work"}', stderr: '' });
    const result = await runJavaEvaluator(makeSubmission(), CONFIG);
    expect(result).toMatchObject({ status: 'COMPLETED', correct: true, feedback: 'Nice work' });
    expect(result.evaluationRaw).toEqual({ correct: true, feedback: 'Nice work' });
    expect(loggedActions()).toContain('SUBMISSION_EVALUATION_SUCCESS');
  });

  it('passes FA-specific args (maxStates + determinism) to the evaluator', async () => {
    const submission = makeSubmission();
    submission.assignmentProblem.problem.type = 'FA';
    submission.assignmentProblem.problem.maxStates = 5;
    submission.assignmentProblem.problem.isDeterministic = true;
    await runJavaEvaluator(submission, CONFIG);
    const [args] = executeMock.mock.calls[0];
    expect(args).toEqual(['--json', expect.stringContaining('answer.txt'), expect.stringContaining('submission.txt'), '5', 'true']);
  });

  it('forwards the configured timeout, memory cap, and analyzer limit', async () => {
    await runJavaEvaluator(makeSubmission(), CONFIG);
    const [, options] = executeMock.mock.calls[0];
    expect(options).toMatchObject({
      timeout: 5_000,
      maxMemoryMb: 256,
      env: { CFGANALYZER_LIMIT: '100' },
    });
  });

  it('substitutes a clean message when the evaluator returns a Java stream toString', async () => {
    executeMock.mockResolvedValue({
      stdout: '{"correct":false,"feedback":"java.lang.IntStream@1a2b3c"}',
      stderr: '',
    });
    const result = await runJavaEvaluator(makeSubmission(), CONFIG);
    expect(result.feedback).toBe('Evaluation completed - correct: false');
  });

  it('logs a warning when the evaluator writes to stderr but still parses stdout', async () => {
    executeMock.mockResolvedValue({ stdout: '{"correct":true,"feedback":"ok"}', stderr: 'a warning' });
    const result = await runJavaEvaluator(makeSubmission(), CONFIG);
    expect(result.correct).toBe(true);
    expect(loggedActions()).toContain('SUBMISSION_EVALUATION_STDERR');
  });

  it('fails on a non-object JSON payload', async () => {
    executeMock.mockResolvedValue({ stdout: '42', stderr: '' });
    const result = await runJavaEvaluator(makeSubmission(), CONFIG);
    expect(result.status).toBe('FAILED');
    expect(result.feedback).toContain('Invalid JSON response');
  });

  it('fails when stdout is not parseable JSON', async () => {
    executeMock.mockResolvedValue({ stdout: 'not json {', stderr: '' });
    const result = await runJavaEvaluator(makeSubmission(), CONFIG);
    expect(result.status).toBe('FAILED');
    expect(result.feedback).toContain('Failed to parse');
  });

  it('fails when the evaluator process throws', async () => {
    executeMock.mockRejectedValue(new Error('jvm crashed'));
    const result = await runJavaEvaluator(makeSubmission(), CONFIG);
    expect(result.status).toBe('FAILED');
    expect(result.feedback).toContain('jvm crashed');
  });
});

describe('evaluateSubmission', () => {
  it('does nothing when the submission no longer exists', async () => {
    prismaMock.submission.findUnique.mockResolvedValue(null);
    await evaluateSubmission('missing');
    expect(prismaMock.submission.update).not.toHaveBeenCalled();
  });

  it('persists the result and autogrades full points when correct', async () => {
    prismaMock.submission.findUnique.mockResolvedValue(makeSubmission());
    executeMock.mockResolvedValue({ stdout: '{"correct":true,"feedback":"great"}', stderr: '' });

    await evaluateSubmission('sub-1');

    expect(prismaMock.submission.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ correct: true, status: 'COMPLETED' }) }),
    );
    expect(prismaMock.assignmentProblemGrade.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ grade: 10 }) }),
    );
    expect(loggedActions()).toContain('SUBMISSION_AUTOGRADED');
  });

  it('autogrades zero points when the submission is incorrect', async () => {
    prismaMock.submission.findUnique.mockResolvedValue(makeSubmission());
    executeMock.mockResolvedValue({ stdout: '{"correct":false,"feedback":"nope"}', stderr: '' });

    await evaluateSubmission('sub-1');

    expect(prismaMock.assignmentProblemGrade.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ grade: 0 }) }),
    );
  });

  it('does not autograde when the problem has the autograder disabled', async () => {
    const submission = makeSubmission();
    submission.assignmentProblem.autograderEnabled = false;
    prismaMock.submission.findUnique.mockResolvedValue(submission);

    await evaluateSubmission('sub-1');

    expect(prismaMock.assignmentProblemGrade.upsert).not.toHaveBeenCalled();
  });

  it('returns a transient failure to PENDING for retry when attempts remain', async () => {
    prismaMock.submission.findUnique.mockResolvedValue(makeSubmission({ attempts: 0 }));
    // First update (result persist) blows up → caught as a transient error.
    prismaMock.submission.update.mockRejectedValueOnce(new Error('db blip'));

    await evaluateSubmission('sub-1');

    // Second update requeues the row.
    expect(prismaMock.submission.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { status: 'PENDING' } }),
    );
    expect(loggedActions()).toContain('SUBMISSION_ERROR');
  });

  it('permanently fails a submission once the attempt budget is exhausted', async () => {
    prismaMock.submission.findUnique.mockResolvedValue(makeSubmission({ attempts: 3 }));
    prismaMock.submission.update.mockRejectedValueOnce(new Error('db blip'));

    await evaluateSubmission('sub-1');

    expect(prismaMock.submission.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
    );
    expect(loggedActions()).toContain('SUBMISSION_FAILED_PERMANENTLY');
  });
});

describe('runWorkerLoop — claiming and prioritization', () => {
  beforeEach(() => {
    // The loop reschedules itself via setTimeout; keep the clock under control.
    vi.useFakeTimers();
    prismaMock.submission.findMany.mockResolvedValue([]); // no in-flight students
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('idles without claiming anything when the queue is empty', async () => {
    prismaMock.submission.findFirst.mockResolvedValue(null);
    await runWorkerLoop();
    expect(prismaMock.submission.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.submission.findUnique).not.toHaveBeenCalled();
  });

  it('claims a pending submission then evaluates it', async () => {
    prismaMock.submission.findFirst.mockResolvedValue({ id: 'sub-1', attempts: 0 });
    prismaMock.submission.updateMany.mockResolvedValue({ count: 1 }); // claim wins
    prismaMock.submission.findUnique.mockResolvedValue(makeSubmission());

    await runWorkerLoop();

    // The claim flips the row to PROCESSING and bumps attempts...
    expect(prismaMock.submission.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'PROCESSING', attempts: { increment: 1 } } }),
    );
    // ...and evaluation runs (findUnique is only reached inside evaluateSubmission).
    expect(prismaMock.submission.findUnique).toHaveBeenCalled();
  });

  it('backs off without evaluating when another worker wins the claim', async () => {
    prismaMock.submission.findFirst.mockResolvedValue({ id: 'sub-1', attempts: 0 });
    prismaMock.submission.updateMany.mockResolvedValue({ count: 0 }); // lost the race

    await runWorkerLoop();

    expect(prismaMock.submission.findUnique).not.toHaveBeenCalled();
  });

  it('poison-pills a submission that exceeded the attempt budget', async () => {
    prismaMock.submission.findFirst.mockResolvedValue({ id: 'sub-1', attempts: 3 });
    prismaMock.submission.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.submission.findUnique.mockResolvedValue({
      id: 'sub-1',
      studentId: 'stu-1',
      courseId: 'c-1',
      assignmentId: 'a-1',
      problemId: 'p-1',
    });

    await runWorkerLoop();

    expect(prismaMock.submission.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
    );
    expect(loggedActions()).toContain('SUBMISSION_FAILED_PERMANENTLY');
  });

  it('logs a queue error when the loop query throws', async () => {
    prismaMock.submission.findMany.mockRejectedValue(new Error('db down'));
    await runWorkerLoop();
    expect(loggedActions()).toContain('SUBMISSION_QUEUE_ERROR');
  });
});

describe('reapStuckSubmissions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getEvaluatorConfigMock.mockResolvedValue(CONFIG);
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('requeues stuck PROCESSING rows and logs the recovery', async () => {
    prismaMock.submission.updateMany.mockResolvedValue({ count: 2 });
    await reapStuckSubmissions();
    expect(prismaMock.submission.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'PENDING' } }),
    );
    expect(loggedActions()).toContain('SUBMISSION_QUEUE_REAPED');
  });

  it('stays quiet when nothing was stuck', async () => {
    prismaMock.submission.updateMany.mockResolvedValue({ count: 0 });
    await reapStuckSubmissions();
    expect(loggedActions()).not.toContain('SUBMISSION_QUEUE_REAPED');
  });

  it('logs a reaper error if the sweep query fails', async () => {
    prismaMock.submission.updateMany.mockRejectedValue(new Error('db down'));
    await reapStuckSubmissions();
    expect(loggedActions()).toContain('SUBMISSION_QUEUE_REAPER_ERROR');
  });
});
