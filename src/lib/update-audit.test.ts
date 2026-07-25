import { beforeEach, describe, expect, it, vi } from 'vitest';

const updates = vi.hoisted(() => ({
  readStatus: vi.fn(),
  readProgressTail: vi.fn(() => ['line 1', 'line 2']),
  readLoggedStatusRequestId: vi.fn(() => ''),
  markStatusLogged: vi.fn(),
}));
vi.mock('@/lib/updates', () => updates);

const createEnhancedActivityLog = vi.hoisted(() => vi.fn());
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog }));

import { reconcileUpdateOutcomeLog } from './update-audit';

// A minimal prisma stub: only activityLog.findFirst is used, to look up the requester.
const findFirst = vi.fn();
const prisma = { activityLog: { findFirst } } as never;
const req = { ipAddress: '127.0.0.1', userAgent: 'test' };

beforeEach(() => {
  vi.clearAllMocks();
  updates.readLoggedStatusRequestId.mockReturnValue('');
  updates.readProgressTail.mockReturnValue(['line 1', 'line 2']);
  findFirst.mockResolvedValue({ userId: 'admin-1' });
});

describe('reconcileUpdateOutcomeLog', () => {
  it('logs a healthy run as SYSTEM_UPDATE_COMPLETED and marks it logged', async () => {
    updates.readStatus.mockReturnValue({
      requestId: 'r1',
      phase: 'healthy',
      fromTag: 'v0.1.18',
      toTag: 'v0.1.19',
      message: 'upgraded to v0.1.19',
    });

    await reconcileUpdateOutcomeLog(prisma, req);

    expect(createEnhancedActivityLog).toHaveBeenCalledTimes(1);
    const [, , data] = createEnhancedActivityLog.mock.calls[0];
    expect(data.action).toBe('SYSTEM_UPDATE_COMPLETED');
    expect(data.severity).toBe('INFO');
    expect(data.userId).toBe('admin-1');
    expect(data.metadata).toMatchObject({ requestId: 'r1', toTag: 'v0.1.19' });
    expect(updates.markStatusLogged).toHaveBeenCalledWith('r1');
  });

  it('logs a failed run as ERROR and a rollback as WARNING', async () => {
    updates.readStatus.mockReturnValue({ requestId: 'r2', phase: 'failed' });
    await reconcileUpdateOutcomeLog(prisma, req);
    expect(createEnhancedActivityLog.mock.calls[0][2]).toMatchObject({
      action: 'SYSTEM_UPDATE_FAILED',
      severity: 'ERROR',
    });

    vi.clearAllMocks();
    updates.readLoggedStatusRequestId.mockReturnValue('');
    updates.readStatus.mockReturnValue({ requestId: 'r3', phase: 'rolled_back' });
    await reconcileUpdateOutcomeLog(prisma, req);
    expect(createEnhancedActivityLog.mock.calls[0][2]).toMatchObject({
      action: 'SYSTEM_UPDATE_ROLLED_BACK',
      severity: 'WARNING',
    });
  });

  it('does nothing for a non-terminal phase', async () => {
    updates.readStatus.mockReturnValue({ requestId: 'r4', phase: 'pulling' });
    await reconcileUpdateOutcomeLog(prisma, req);
    expect(createEnhancedActivityLog).not.toHaveBeenCalled();
    expect(updates.markStatusLogged).not.toHaveBeenCalled();
  });

  it('does not log the same run twice', async () => {
    updates.readStatus.mockReturnValue({ requestId: 'r5', phase: 'healthy' });
    updates.readLoggedStatusRequestId.mockReturnValue('r5');
    await reconcileUpdateOutcomeLog(prisma, req);
    expect(createEnhancedActivityLog).not.toHaveBeenCalled();
  });

  it('falls back to a system actor when the requester cannot be found', async () => {
    updates.readStatus.mockReturnValue({ requestId: 'r6', phase: 'healthy' });
    findFirst.mockResolvedValue(null);
    await reconcileUpdateOutcomeLog(prisma, req);
    expect(createEnhancedActivityLog.mock.calls[0][2].userId).toBeNull();
  });

  it('does not mark logged if the log write fails, so it can retry', async () => {
    updates.readStatus.mockReturnValue({ requestId: 'r7', phase: 'healthy' });
    createEnhancedActivityLog.mockRejectedValueOnce(new Error('db down'));
    await reconcileUpdateOutcomeLog(prisma, req);
    expect(updates.markStatusLogged).not.toHaveBeenCalled();
  });
});
