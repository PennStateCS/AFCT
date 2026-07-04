import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  systemSettings: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
}));

const authMock = vi.hoisted(() => vi.fn());
const auditMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: auditMock }));

import { GET, PUT } from './route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/system-settings', () => {
  it('returns 403 when not authorized', async () => {
    authMock.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(403);
  });

  it('returns 403 for a non-privileged role', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });

    const res = await GET();

    expect(res.status).toBe(403);
    expect(prismaMock.systemSettings.findUnique).not.toHaveBeenCalled();
  });

  it('returns settings with defaults', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.systemSettings.findUnique.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      timezone: 'UTC',
      maxUploadSizeMb: 25,
      allowSignup: true,
      sessionTimeoutMinutes: 20,
      submissionEvalTimeoutMs: 30000,
      submissionEvalMaxMemoryMb: 256,
      submissionResubmitCooldownMs: 10000,
      submissionMaxConcurrent: 5,
      submissionMaxAttempts: 3,
      submissionAnalyzerLimit: 15,
      hcaptchaSiteKey: '',
      hcaptchaSecretConfigured: false,
    });
  });

  it('returns stored settings', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.systemSettings.findUnique.mockResolvedValue({
      id: 1,
      timezone: 'America/New_York',
      maxUploadSizeMb: 100,
      allowSignup: false,
      sessionTimeoutMinutes: 45,
      submissionEvalTimeoutMs: 45000,
      submissionEvalMaxMemoryMb: 512,
      submissionResubmitCooldownMs: 5000,
      submissionMaxConcurrent: 8,
      submissionMaxAttempts: 2,
      submissionAnalyzerLimit: 40,
    });

    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      timezone: 'America/New_York',
      maxUploadSizeMb: 100,
      allowSignup: false,
      sessionTimeoutMinutes: 45,
      submissionEvalTimeoutMs: 45000,
      submissionEvalMaxMemoryMb: 512,
      submissionResubmitCooldownMs: 5000,
      submissionMaxConcurrent: 8,
      submissionMaxAttempts: 2,
      submissionAnalyzerLimit: 40,
      hcaptchaSiteKey: '',
      hcaptchaSecretConfigured: false,
    });
  });
});

describe('PUT /api/system-settings', () => {
  it('returns 403 when not authorized', async () => {
    authMock.mockResolvedValue(null);

    const req = new Request('http://localhost/api/system-settings', {
      method: 'PUT',
      body: JSON.stringify({ timezone: 'UTC', maxUploadSizeMb: 50 }),
    });

    const res = await PUT(req);

    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid JSON body', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });

    const req = new Request('http://localhost/api/system-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });

    const res = await PUT(req);

    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid timezone', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });

    const req = new Request('http://localhost/api/system-settings', {
      method: 'PUT',
      body: JSON.stringify({ timezone: 'Bad/Zone', maxUploadSizeMb: 10 }),
    });

    const res = await PUT(req);

    expect(res.status).toBe(400);
  });

  it('upserts settings and clamps size', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.systemSettings.upsert.mockResolvedValue({
      id: 1,
      timezone: 'UTC',
      maxUploadSizeMb: 1,
      allowSignup: true,
      sessionTimeoutMinutes: 20,
    });

    const req = new Request('http://localhost/api/system-settings', {
      method: 'PUT',
      body: JSON.stringify({ timezone: 'UTC', maxUploadSizeMb: -5 }),
    });

    const res = await PUT(req);

    expect(res.status).toBe(200);
    expect(prismaMock.systemSettings.upsert).toHaveBeenCalledWith({
      where: { id: 1 },
      update: { timezone: 'UTC', maxUploadSizeMb: 1, sessionTimeoutMinutes: 20 },
      create: { id: 1, timezone: 'UTC', maxUploadSizeMb: 1, sessionTimeoutMinutes: 20 },
    });
  });

  it('persists allowSignup when provided', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.systemSettings.upsert.mockResolvedValue({
      id: 1,
      timezone: 'UTC',
      maxUploadSizeMb: 20,
      allowSignup: false,
      sessionTimeoutMinutes: 30,
      submissionEvalTimeoutMs: 30000,
      submissionEvalMaxMemoryMb: 256,
      submissionResubmitCooldownMs: 10000,
      submissionMaxConcurrent: 5,
      submissionMaxAttempts: 3,
    });

    const req = new Request('http://localhost/api/system-settings', {
      method: 'PUT',
      body: JSON.stringify({
        timezone: 'UTC',
        maxUploadSizeMb: 20,
        allowSignup: false,
        sessionTimeoutMinutes: 30,
      }),
    });

    const res = await PUT(req);

    expect(res.status).toBe(200);
    expect(prismaMock.systemSettings.upsert).toHaveBeenCalledWith({
      where: { id: 1 },
      update: {
        timezone: 'UTC',
        maxUploadSizeMb: 20,
        allowSignup: false,
        sessionTimeoutMinutes: 30,
      },
      create: {
        id: 1,
        timezone: 'UTC',
        maxUploadSizeMb: 20,
        allowSignup: false,
        sessionTimeoutMinutes: 30,
      },
    });
    const body = await res.json();
    expect(body).toEqual({
      timezone: 'UTC',
      maxUploadSizeMb: 20,
      allowSignup: false,
      sessionTimeoutMinutes: 30,
      submissionEvalTimeoutMs: 30000,
      submissionEvalMaxMemoryMb: 256,
      submissionResubmitCooldownMs: 10000,
      submissionMaxConcurrent: 5,
      submissionMaxAttempts: 3,
      hcaptchaSiteKey: '',
      hcaptchaSecretConfigured: false,
    });
  });

  it('clamps and persists submission queue settings when provided', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.systemSettings.upsert.mockResolvedValue({
      id: 1,
      timezone: 'UTC',
      maxUploadSizeMb: 25,
      allowSignup: true,
      sessionTimeoutMinutes: 20,
      submissionEvalTimeoutMs: 600000,
      submissionEvalMaxMemoryMb: 64,
      submissionResubmitCooldownMs: 10000,
      submissionMaxConcurrent: 20,
      submissionMaxAttempts: 3,
    });

    const req = new Request('http://localhost/api/system-settings', {
      method: 'PUT',
      body: JSON.stringify({
        timezone: 'UTC',
        maxUploadSizeMb: 25,
        submissionEvalTimeoutMs: 99_999_999, // above the 10m ceiling
        submissionEvalMaxMemoryMb: 1, // below the 64MB floor
        submissionMaxConcurrent: 999, // above the cap
      }),
    });

    const res = await PUT(req);

    expect(res.status).toBe(200);
    const call = prismaMock.systemSettings.upsert.mock.calls[0][0];
    expect(call.update).toMatchObject({
      submissionEvalTimeoutMs: 600000,
      submissionEvalMaxMemoryMb: 64,
      submissionMaxConcurrent: 20,
    });
    // Fields not sent are left untouched.
    expect(call.update.submissionResubmitCooldownMs).toBeUndefined();
    expect(call.update.submissionMaxAttempts).toBeUndefined();
  });

  const okUpsert = () =>
    prismaMock.systemSettings.upsert.mockResolvedValue({
      id: 1,
      timezone: 'UTC',
      maxUploadSizeMb: 25,
      allowSignup: true,
      sessionTimeoutMinutes: 20,
      submissionEvalTimeoutMs: 30000,
      submissionEvalMaxMemoryMb: 256,
      submissionResubmitCooldownMs: 10000,
      submissionMaxConcurrent: 5,
      submissionMaxAttempts: 3,
      submissionAnalyzerLimit: 15,
      hcaptchaSiteKey: 'site-1',
      hcaptchaSecretKey: 'secret-1',
    });

  const putBody = (body: Record<string, unknown>) =>
    new Request('http://localhost/api/system-settings', {
      method: 'PUT',
      body: JSON.stringify({ timezone: 'UTC', maxUploadSizeMb: 25, ...body }),
    });

  it('persists hcaptcha site + secret keys and never echoes the secret', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    okUpsert();

    const res = await PUT(putBody({ hcaptchaSiteKey: ' site-1 ', hcaptchaSecretKey: ' secret-1 ' }));

    expect(res.status).toBe(200);
    const call = prismaMock.systemSettings.upsert.mock.calls[0][0];
    expect(call.update).toMatchObject({ hcaptchaSiteKey: 'site-1', hcaptchaSecretKey: 'secret-1' });
    const body = await res.json();
    expect(body.hcaptchaSiteKey).toBe('site-1');
    expect(body.hcaptchaSecretConfigured).toBe(true);
    expect(body.hcaptchaSecretKey).toBeUndefined();
  });

  it('keeps the existing secret when a blank secret is sent', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    okUpsert();

    const res = await PUT(putBody({ hcaptchaSiteKey: 'site-1', hcaptchaSecretKey: '' }));

    expect(res.status).toBe(200);
    const call = prismaMock.systemSettings.upsert.mock.calls[0][0];
    expect(call.update.hcaptchaSiteKey).toBe('site-1');
    expect(call.update.hcaptchaSecretKey).toBeUndefined(); // untouched
  });

  it('clears the secret when hcaptchaSecretClear is set', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    okUpsert();

    const res = await PUT(putBody({ hcaptchaSecretClear: true, hcaptchaSecretKey: 'ignored' }));

    expect(res.status).toBe(200);
    const call = prismaMock.systemSettings.upsert.mock.calls[0][0];
    expect(call.update.hcaptchaSecretKey).toBeNull();
  });

  it('clamps session timeout to minimum when too low', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.systemSettings.upsert.mockResolvedValue({
      id: 1,
      timezone: 'UTC',
      maxUploadSizeMb: 25,
      allowSignup: true,
      sessionTimeoutMinutes: 5,
    });

    const req = new Request('http://localhost/api/system-settings', {
      method: 'PUT',
      body: JSON.stringify({ timezone: 'UTC', maxUploadSizeMb: 25, sessionTimeoutMinutes: 1 }),
    });

    const res = await PUT(req);

    expect(res.status).toBe(200);
    expect(prismaMock.systemSettings.upsert).toHaveBeenCalledWith({
      where: { id: 1 },
      update: { timezone: 'UTC', maxUploadSizeMb: 25, sessionTimeoutMinutes: 5 },
      create: { id: 1, timezone: 'UTC', maxUploadSizeMb: 25, sessionTimeoutMinutes: 5 },
    });
  });

  it('returns 403 for a non-privileged role', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });

    const res = await PUT(putBody({}));

    expect(res.status).toBe(403);
    expect(prismaMock.systemSettings.upsert).not.toHaveBeenCalled();
  });

  it('allows a FACULTY user to update settings', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    okUpsert();

    const res = await PUT(putBody({}));

    expect(res.status).toBe(200);
    expect(prismaMock.systemSettings.upsert).toHaveBeenCalled();
  });

  it('clamps maxUploadSizeMb above the maximum', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    okUpsert();

    const res = await PUT(putBody({ maxUploadSizeMb: 999_999 }));

    expect(res.status).toBe(200);
    const call = prismaMock.systemSettings.upsert.mock.calls[0][0];
    expect(call.update.maxUploadSizeMb).toBe(1024);
    expect(call.create.maxUploadSizeMb).toBe(1024);
  });

  it('clamps submissionAnalyzerLimit above the cap', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    okUpsert();

    const res = await PUT(putBody({ submissionAnalyzerLimit: 999 }));

    expect(res.status).toBe(200);
    const call = prismaMock.systemSettings.upsert.mock.calls[0][0];
    expect(call.update.submissionAnalyzerLimit).toBe(100);
    expect(call.create.submissionAnalyzerLimit).toBe(100);
  });

  it('clamps submissionAnalyzerLimit below the floor', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    okUpsert();

    const res = await PUT(putBody({ submissionAnalyzerLimit: 0 }));

    expect(res.status).toBe(200);
    const call = prismaMock.systemSettings.upsert.mock.calls[0][0];
    expect(call.update.submissionAnalyzerLimit).toBe(1);
  });

  it('leaves submissionAnalyzerLimit untouched when not provided', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    okUpsert();

    const res = await PUT(putBody({}));

    expect(res.status).toBe(200);
    const call = prismaMock.systemSettings.upsert.mock.calls[0][0];
    expect(call.update.submissionAnalyzerLimit).toBeUndefined();
  });

  it('clears the site key when a blank value is sent', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    okUpsert();

    const res = await PUT(putBody({ hcaptchaSiteKey: '   ' }));

    expect(res.status).toBe(200);
    const call = prismaMock.systemSettings.upsert.mock.calls[0][0];
    expect(call.update.hcaptchaSiteKey).toBeNull();
  });

  it('records an audit log with a before/after diff when a setting changes', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.systemSettings.findUnique.mockResolvedValue({
      id: 1,
      timezone: 'UTC',
      maxUploadSizeMb: 25,
      sessionTimeoutMinutes: 20,
    });
    prismaMock.systemSettings.upsert.mockResolvedValue({
      id: 1,
      timezone: 'America/New_York',
      maxUploadSizeMb: 25,
      sessionTimeoutMinutes: 20,
    });

    const res = await PUT(putBody({ timezone: 'America/New_York' }));

    expect(res.status).toBe(200);
    expect(auditMock).toHaveBeenCalledTimes(1);
    const data = auditMock.mock.calls[0][2] as {
      userId: string;
      action: string;
      metadata: { changedFields: string[]; changes: Record<string, unknown> };
    };
    expect(data.userId).toBe('u1');
    expect(data.action).toBe('SYSTEM_SETTINGS_UPDATED');
    expect(data.metadata.changedFields).toContain('timezone');
    expect(data.metadata.changes.timezone).toEqual({ from: 'UTC', to: 'America/New_York' });
  });

  it('never logs the hCaptcha secret value, only that it changed', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.systemSettings.findUnique.mockResolvedValue({ id: 1, timezone: 'UTC', maxUploadSizeMb: 25 });
    okUpsert();

    const res = await PUT(putBody({ hcaptchaSecretKey: 'super-secret-value' }));

    expect(res.status).toBe(200);
    const serialized = JSON.stringify(auditMock.mock.calls[0][2]);
    expect(serialized).not.toContain('super-secret-value');
    const data = auditMock.mock.calls[0][2] as { metadata: { hcaptchaSecretUpdated: boolean } };
    expect(data.metadata.hcaptchaSecretUpdated).toBe(true);
  });

  it('skips the audit log on a no-op save', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    const row = {
      id: 1,
      timezone: 'UTC',
      maxUploadSizeMb: 25,
      allowSignup: true,
      sessionTimeoutMinutes: 20,
    };
    prismaMock.systemSettings.findUnique.mockResolvedValue(row);
    prismaMock.systemSettings.upsert.mockResolvedValue(row);

    const res = await PUT(putBody({}));

    expect(res.status).toBe(200);
    expect(auditMock).not.toHaveBeenCalled();
  });

  it('records a denied audit log when a non-privileged user attempts an update', async () => {
    authMock.mockResolvedValue({ user: { id: 'u9', role: 'STUDENT' } });

    const res = await PUT(putBody({}));

    expect(res.status).toBe(403);
    expect(auditMock).toHaveBeenCalledTimes(1);
    const data = auditMock.mock.calls[0][2] as { userId: string; action: string };
    expect(data.userId).toBe('u9');
    expect(data.action).toBe('SYSTEM_SETTINGS_UPDATE_DENIED');
  });
});
