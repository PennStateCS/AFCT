import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// POST /api/log_submission writes a SUBMISSION activity log built from the
// posted submission, action and metadata. It is a fire-and-forget logging
// endpoint, so the assertions focus on the payload passed to the logger.

const activityLogMock = vi.hoisted(() => vi.fn());
const prismaMock = vi.hoisted(() => ({}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));

import { POST } from './route';

const makeRequest = (body: unknown) =>
  new NextRequest('http://localhost/api/log_submission', {
    method: 'POST',
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/log_submission', () => {
  it('builds a submission log payload from the request body', async () => {
    await POST(
      makeRequest({
        submission: {
          id: 's1',
          studentId: 'u1',
          assignmentId: 'a1',
          problemId: 'p1',
          assignment: { courseId: 'c1' },
        },
        action: 'SUBMISSION_VIEWED',
        metadata: { source: 'ui' },
      }),
    );

    expect(activityLogMock).toHaveBeenCalledTimes(1);
    const payload = activityLogMock.mock.calls[0][2];
    expect(payload).toMatchObject({
      userId: 'u1',
      action: 'SUBMISSION_VIEWED',
      category: 'SUBMISSION',
      courseId: 'c1',
      assignmentId: 'a1',
      problemId: 'p1',
      submissionId: 's1',
      metadata: { submissionId: 's1', source: 'ui' },
    });
  });

  it('defaults missing fields to null and metadata to just the submission id', async () => {
    await POST(
      makeRequest({
        submission: { id: 's2' },
        action: 'SUBMISSION_VIEWED',
      }),
    );

    const payload = activityLogMock.mock.calls[0][2];
    expect(payload).toMatchObject({
      userId: null,
      courseId: null,
      assignmentId: null,
      problemId: null,
      submissionId: 's2',
      metadata: { submissionId: 's2' },
    });
  });
});
