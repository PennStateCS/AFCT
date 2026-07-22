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
  assignmentProblemGrade: { upsert: vi.fn(), updateMany: vi.fn(), createMany: vi.fn() },
  groupMembership: { findMany: vi.fn() },
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
      // TIMEOUT_SECONDS is the eval timeout in whole seconds (5000ms -> '5'); the jar
      // needs it to early-stop upgraded feedback, and UPGRADED_FEEDBACK is set explicitly.
      env: { CFGANALYZER_LIMIT: '100', TIMEOUT_SECONDS: '5', UPGRADED_FEEDBACK: 'true' },
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
  beforeEach(() => {
    // Happy-path defaults; individual tests override as needed.
    prismaMock.submission.updateMany.mockResolvedValue({ count: 1 }); // fenced completion write wins
    prismaMock.assignmentProblemGrade.updateMany.mockResolvedValue({ count: 0 }); // no existing auto row
    prismaMock.assignmentProblemGrade.createMany.mockResolvedValue({ count: 1 });
  });

  it('does nothing when the submission no longer exists', async () => {
    prismaMock.submission.findUnique.mockResolvedValue(null);
    await evaluateSubmission('missing');
    expect(prismaMock.submission.updateMany).not.toHaveBeenCalled();
  });

  it('persists the result and autogrades full points when correct', async () => {
    prismaMock.submission.findUnique.mockResolvedValue(makeSubmission());
    executeMock.mockResolvedValue({ stdout: '{"correct":true,"feedback":"great"}', stderr: '' });

    await evaluateSubmission('sub-1');

    expect(prismaMock.submission.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ correct: true, status: 'COMPLETED' }) }),
    );
    // Autograde only touches a non-manual row, and creates a non-manual row.
    expect(prismaMock.assignmentProblemGrade.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ gradedManually: false }) }),
    );
    expect(prismaMock.assignmentProblemGrade.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ grade: 10, gradedManually: false })],
        skipDuplicates: true,
      }),
    );
    expect(loggedActions()).toContain('SUBMISSION_AUTOGRADED');
  });

  it('autogrades zero points when the submission is incorrect', async () => {
    prismaMock.submission.findUnique.mockResolvedValue(makeSubmission());
    executeMock.mockResolvedValue({ stdout: '{"correct":false,"feedback":"nope"}', stderr: '' });

    await evaluateSubmission('sub-1');

    expect(prismaMock.assignmentProblemGrade.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: [expect.objectContaining({ grade: 0 })] }),
    );
  });

  it('updates an existing non-manual grade in place (createMany is a no-op via skipDuplicates)', async () => {
    prismaMock.submission.findUnique.mockResolvedValue(makeSubmission());
    executeMock.mockResolvedValue({ stdout: '{"correct":true,"feedback":"great"}', stderr: '' });
    prismaMock.assignmentProblemGrade.updateMany.mockResolvedValue({ count: 1 }); // a non-manual row existed

    await evaluateSubmission('sub-1');

    expect(prismaMock.assignmentProblemGrade.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ grade: 10 }) }),
    );
    // createMany runs but skips the existing row via skipDuplicates.
    expect(prismaMock.assignmentProblemGrade.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
  });

  it('fans a group submission grade out to every group member', async () => {
    const groupSub = { ...makeSubmission(), studentGroupId: 'grp-1' };
    prismaMock.submission.findUnique.mockResolvedValue(groupSub);
    prismaMock.groupMembership.findMany.mockResolvedValue([
      { userId: 'm1' },
      { userId: 'm2' },
      { userId: 'm3' },
    ]);
    executeMock.mockResolvedValue({ stdout: '{"correct":true,"feedback":"great"}', stderr: '' });

    await evaluateSubmission('sub-1');

    // Non-manual rows for all three members are updated, and createMany covers all three.
    expect(prismaMock.assignmentProblemGrade.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ studentId: { in: ['m1', 'm2', 'm3'] } }),
      }),
    );
    const createArg = prismaMock.assignmentProblemGrade.createMany.mock.calls[0]![0];
    expect(createArg.data.map((r: { studentId: string }) => r.studentId)).toEqual([
      'm1',
      'm2',
      'm3',
    ]);
  });

  it('does not autograde when the problem has the autograder disabled', async () => {
    const submission = makeSubmission();
    submission.assignmentProblem.autograderEnabled = false;
    prismaMock.submission.findUnique.mockResolvedValue(submission);

    await evaluateSubmission('sub-1');

    expect(prismaMock.assignmentProblemGrade.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.assignmentProblemGrade.createMany).not.toHaveBeenCalled();
  });

  it('discards a stale result (and skips autograde) when the row was reclaimed mid-evaluation', async () => {
    prismaMock.submission.findUnique.mockResolvedValue(makeSubmission());
    executeMock.mockResolvedValue({ stdout: '{"correct":true,"feedback":"great"}', stderr: '' });
    // The fenced completion write matches nothing: another worker re-claimed the row.
    prismaMock.submission.updateMany.mockResolvedValue({ count: 0 });

    await evaluateSubmission('sub-1');

    expect(prismaMock.assignmentProblemGrade.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.assignmentProblemGrade.createMany).not.toHaveBeenCalled();
    expect(loggedActions()).not.toContain('SUBMISSION_AUTOGRADED');
  });

  it('returns a transient failure to PENDING for retry when attempts remain', async () => {
    prismaMock.submission.findUnique.mockResolvedValue(makeSubmission({ attempts: 0 }));
    // The completion write blows up → caught as a transient error.
    prismaMock.submission.updateMany.mockRejectedValueOnce(new Error('db blip'));

    await evaluateSubmission('sub-1');

    // The error path requeues the row (fenced on the claim attempts).
    expect(prismaMock.submission.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { status: 'PENDING' } }),
    );
    expect(loggedActions()).toContain('SUBMISSION_ERROR');
  });

  it('permanently fails a submission once the attempt budget is exhausted', async () => {
    prismaMock.submission.findUnique.mockResolvedValue(makeSubmission({ attempts: 3 }));
    prismaMock.submission.updateMany.mockRejectedValueOnce(new Error('db blip'));

    await evaluateSubmission('sub-1');

    expect(prismaMock.submission.updateMany).toHaveBeenLastCalledWith(
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
