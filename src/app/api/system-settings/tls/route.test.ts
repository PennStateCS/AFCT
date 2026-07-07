import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.hoisted(() => vi.fn());
const auditMock = vi.hoisted(() => vi.fn());
const CertValidationError = vi.hoisted(() => class CertValidationError extends Error {});
const tls = vi.hoisted(() => ({
  readCertInfo: vi.fn(() => ({ installed: false })),
  installCert: vi.fn(() => ({ installed: true, subject: 'CN=uploaded' })),
  clearCert: vi.fn(() => ({ installed: false })),
  hasPendingCsr: vi.fn(() => false),
  generateCsr: vi.fn(() => ({ csr: 'CSR-PEM' })),
  installSignedCert: vi.fn(() => ({ installed: true, subject: 'CN=signed' })),
  generateSelfSigned: vi.fn(() => ({ installed: true, subject: 'CN=self', selfSigned: true })),
}));

vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: auditMock }));
vi.mock('@/lib/tls-cert', () => ({ ...tls, CertValidationError }));

import { GET, POST, DELETE } from './route';

const admin = { user: { id: 'a1', role: 'ADMIN', isAdmin: true } };

const post = (body: unknown) =>
  new Request('http://localhost/api/system-settings/tls', {
    method: 'POST',
    body: JSON.stringify(body),
  });

// The action object handed to the audit logger (createEnhancedActivityLog's 3rd arg).
const lastAudit = () => auditMock.mock.calls[auditMock.mock.calls.length - 1][2];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TLS route authorization', () => {
  it('GET returns 403 for a non-admin (faculty is not enough here)', async () => {
    authMock.mockResolvedValue({ user: { id: 'f1', role: 'FACULTY' } });
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it('POST logs a denied attempt for an authenticated non-admin', async () => {
    authMock.mockResolvedValue({ user: { id: 'f1', role: 'FACULTY' } });

    const res = await POST(post({ action: 'self-signed', commonName: 'x' }));

    expect(res.status).toBe(403);
    expect(tls.generateSelfSigned).not.toHaveBeenCalled();
    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(lastAudit().action).toBe('TLS_UPDATE_DENIED');
  });
});

describe('TLS route actions', () => {
  it('installs a self-signed certificate and logs TLS_CERT_INSTALLED', async () => {
    authMock.mockResolvedValue(admin);

    const res = await POST(post({ action: 'self-signed', commonName: 'afct.local' }));

    expect(res.status).toBe(200);
    expect(tls.generateSelfSigned).toHaveBeenCalled();
    const audit = lastAudit();
    expect(audit.action).toBe('TLS_CERT_INSTALLED');
    expect(audit.metadata.method).toBe('self-signed');
    expect(audit.userId).toBe('a1');
  });

  it('generates a CSR and logs TLS_CSR_GENERATED', async () => {
    authMock.mockResolvedValue(admin);

    const res = await POST(post({ action: 'generate-csr', commonName: 'afct.local' }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.csr).toBe('CSR-PEM');
    expect(lastAudit().action).toBe('TLS_CSR_GENERATED');
  });

  it('resets to self-signed and logs TLS_CERT_RESET', async () => {
    authMock.mockResolvedValue(admin);

    const res = await DELETE(
      new Request('http://localhost/api/system-settings/tls', { method: 'DELETE' }),
    );

    expect(res.status).toBe(200);
    expect(tls.clearCert).toHaveBeenCalled();
    expect(lastAudit().action).toBe('TLS_CERT_RESET');
  });

  it('rejects an invalid certificate with 400 and logs TLS_CERT_REJECTED without key material', async () => {
    authMock.mockResolvedValue(admin);
    tls.installCert.mockImplementationOnce(() => {
      throw new CertValidationError('The private key does not match the certificate.');
    });

    const res = await POST(post({ action: 'install', cert: 'CERT', key: 'SECRET-KEY-MATERIAL' }));

    expect(res.status).toBe(400);
    const audit = lastAudit();
    expect(audit.action).toBe('TLS_CERT_REJECTED');
    expect(audit.metadata.reason).toBe('The private key does not match the certificate.');
    // The uploaded key/cert bodies must never reach the audit log.
    expect(JSON.stringify(auditMock.mock.calls)).not.toContain('SECRET-KEY-MATERIAL');
  });

  it('logs TLS_CERT_ERROR and returns 500 on an unexpected failure', async () => {
    authMock.mockResolvedValue(admin);
    tls.generateSelfSigned.mockImplementationOnce(() => {
      throw new Error('openssl not found');
    });

    const res = await POST(post({ action: 'self-signed', commonName: 'x' }));

    expect(res.status).toBe(500);
    expect(lastAudit().action).toBe('TLS_CERT_ERROR');
  });
});
