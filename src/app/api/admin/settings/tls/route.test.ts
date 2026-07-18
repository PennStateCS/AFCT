import { beforeEach, describe, expect, it, vi } from 'vitest';
import { routeCtx, testRequest } from '@/test/route';
import type { CertInfo } from '@/lib/tls-cert';

const authMock = vi.hoisted(() => vi.fn());
const auditMock = vi.hoisted(() => vi.fn());
const CertValidationError = vi.hoisted(() => class CertValidationError extends Error {});
const tls = vi.hoisted(() => ({
  readCertInfo: vi.fn((): CertInfo => ({ installed: false })),
  installCert: vi.fn((): CertInfo => ({ installed: true, subject: 'CN=uploaded' })),
  clearCert: vi.fn((): CertInfo => ({ installed: false })),
  hasPendingCsr: vi.fn(() => false),
  generateCsr: vi.fn(() => ({ csr: 'CSR-PEM' })),
  installSignedCert: vi.fn((): CertInfo => ({ installed: true, subject: 'CN=signed' })),
  generateSelfSigned: vi.fn((): CertInfo => ({
    installed: true,
    subject: 'CN=self',
    selfSigned: true,
  })),
}));

const AcmeError = vi.hoisted(() => class AcmeError extends Error {});
const acme = vi.hoisted(() => ({
  requestCertificate: vi.fn(async () => ({
    installed: true,
    subject: 'CN=le',
    validTo: '2030-01-01',
  })),
  disableAcme: vi.fn(),
  getAcmeState: vi.fn(() => ({ managed: false }) as Record<string, unknown>),
}));

vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: auditMock }));
vi.mock('@/lib/tls-cert', () => ({ ...tls, CertValidationError }));
vi.mock('@/lib/acme', () => ({ ...acme, AcmeError }));

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
    const res = await GET(testRequest(), routeCtx());
    expect(res.status).toBe(403);
  });

  it('POST logs a denied attempt for an authenticated non-admin', async () => {
    authMock.mockResolvedValue({ user: { id: 'f1', role: 'FACULTY' } });

    const res = await POST(post({ action: 'self-signed', commonName: 'x' }), routeCtx());

    expect(res.status).toBe(403);
    expect(tls.generateSelfSigned).not.toHaveBeenCalled();
    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(lastAudit().action).toBe('TLS_UPDATE_DENIED');
  });
});

describe('TLS route actions', () => {
  it('installs a self-signed certificate and logs TLS_CERT_INSTALLED', async () => {
    authMock.mockResolvedValue(admin);

    const res = await POST(post({ action: 'self-signed', commonName: 'afct.local' }), routeCtx());

    expect(res.status).toBe(200);
    expect(tls.generateSelfSigned).toHaveBeenCalled();
    const audit = lastAudit();
    expect(audit.action).toBe('TLS_CERT_INSTALLED');
    expect(audit.metadata.method).toBe('self-signed');
    expect(audit.userId).toBe('a1');
  });

  it('generates a CSR and logs TLS_CSR_GENERATED', async () => {
    authMock.mockResolvedValue(admin);

    const res = await POST(post({ action: 'generate-csr', commonName: 'afct.local' }), routeCtx());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.csr).toBe('CSR-PEM');
    expect(lastAudit().action).toBe('TLS_CSR_GENERATED');
  });

  it('resets to self-signed and logs TLS_CERT_RESET', async () => {
    authMock.mockResolvedValue(admin);

    const res = await DELETE(
      new Request('http://localhost/api/system-settings/tls', { method: 'DELETE' }),
      routeCtx(),
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

    const res = await POST(
      post({ action: 'install', cert: 'CERT', key: 'SECRET-KEY-MATERIAL' }),
      routeCtx(),
    );

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

    const res = await POST(post({ action: 'self-signed', commonName: 'x' }), routeCtx());

    expect(res.status).toBe(500);
    expect(lastAudit().action).toBe('TLS_CERT_ERROR');
  });

  it('GET returns the current cert info plus the pending-CSR flag for an admin', async () => {
    authMock.mockResolvedValue(admin);
    tls.readCertInfo.mockReturnValueOnce({ installed: true, subject: 'CN=current' });
    tls.hasPendingCsr.mockReturnValueOnce(true);

    const res = await GET(testRequest(), routeCtx());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      installed: true,
      subject: 'CN=current',
      pendingCsr: true,
      acme: { managed: false },
    });
  });

  it('returns 400 for an invalid JSON body', async () => {
    authMock.mockResolvedValue(admin);

    const req = new Request('http://localhost/api/system-settings/tls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });

    const res = await POST(req, routeCtx());

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid JSON body');
  });

  it('installs a signed certificate and logs TLS_CERT_INSTALLED (csr-signed)', async () => {
    authMock.mockResolvedValue(admin);

    const res = await POST(
      post({ action: 'install-signed', cert: 'SIGNED-CERT', chain: 'CHAIN' }),
      routeCtx(),
    );

    expect(res.status).toBe(200);
    expect(tls.installSignedCert).toHaveBeenCalledWith('SIGNED-CERT', 'CHAIN');
    const audit = lastAudit();
    expect(audit.action).toBe('TLS_CERT_INSTALLED');
    expect(audit.metadata.method).toBe('csr-signed');
  });

  it('installs an uploaded cert+key via the default install action', async () => {
    authMock.mockResolvedValue(admin);

    const res = await POST(post({ cert: 'CERT', key: 'KEY' }), routeCtx());

    expect(res.status).toBe(200);
    expect(tls.installCert).toHaveBeenCalledWith('CERT', 'KEY', undefined);
    const audit = lastAudit();
    expect(audit.action).toBe('TLS_CERT_INSTALLED');
    expect(audit.metadata.method).toBe('upload');
  });

  it('still succeeds when the audit log itself throws (error swallowed)', async () => {
    authMock.mockResolvedValue(admin);
    auditMock.mockRejectedValueOnce(new Error('log sink down'));

    const res = await POST(post({ action: 'self-signed', commonName: 'afct.local' }), routeCtx());

    expect(res.status).toBe(200);
  });

  it('passes altNames through to CSR generation when provided as an array', async () => {
    authMock.mockResolvedValue(admin);

    const res = await POST(
      post({ action: 'generate-csr', commonName: 'afct.local', altNames: ['a.local', 'b.local'] }),
      routeCtx(),
    );

    expect(res.status).toBe(200);
    const audit = lastAudit();
    expect(audit.metadata.altNames).toEqual(['a.local', 'b.local']);
  });

  it('defaults cert/key to empty strings when omitted on the install actions', async () => {
    authMock.mockResolvedValue(admin);
    // Full CertInfo so certMeta records every field (exercises the non-null sides).
    tls.installCert.mockReturnValueOnce({
      installed: true,
      subject: 'CN=x',
      issuer: 'CN=ca',
      validTo: '2030-01-01',
      selfSigned: false,
    });

    // No cert/key in the body -> installCert('', '', undefined).
    const installRes = await POST(post({ action: 'install' }), routeCtx());
    expect(installRes.status).toBe(200);
    expect(tls.installCert).toHaveBeenCalledWith('', '', undefined);

    // No cert in the body -> installSignedCert('', undefined).
    const signedRes = await POST(post({ action: 'install-signed' }), routeCtx());
    expect(signedRes.status).toBe(200);
    expect(tls.installSignedCert).toHaveBeenCalledWith('', undefined);
  });

  it('records null cert metadata when the CertInfo omits every detail field', async () => {
    authMock.mockResolvedValue(admin);
    // A bare CertInfo -> certMeta coalesces each missing field to null.
    tls.installCert.mockReturnValueOnce({ installed: true });

    const res = await POST(post({ action: 'install', cert: 'C', key: 'K' }), routeCtx());

    expect(res.status).toBe(200);
    const audit = lastAudit();
    expect(audit.metadata).toMatchObject({
      subject: null,
      issuer: null,
      validTo: null,
      selfSigned: null,
    });
  });

  it('records "install" as the attempted action when none is supplied (rejected cert)', async () => {
    authMock.mockResolvedValue(admin);
    tls.installCert.mockImplementationOnce(() => {
      throw new CertValidationError('bad cert');
    });

    // No action field -> falls through to the default install path.
    const res = await POST(post({ cert: 'CERT', key: 'KEY' }), routeCtx());

    expect(res.status).toBe(400);
    expect(lastAudit().metadata.attempted).toBe('install');
  });

  it('records "install" as the attempted action when none is supplied (unexpected error)', async () => {
    authMock.mockResolvedValue(admin);
    tls.installCert.mockImplementationOnce(() => {
      throw new Error('boom');
    });

    const res = await POST(post({ cert: 'CERT', key: 'KEY' }), routeCtx());

    expect(res.status).toBe(500);
    const audit = lastAudit();
    expect(audit.action).toBe('TLS_CERT_ERROR');
    expect(audit.metadata.attempted).toBe('install');
  });

  it('obtains a Let’s Encrypt certificate and logs TLS_CERT_INSTALLED (lets-encrypt)', async () => {
    authMock.mockResolvedValue(admin);
    acme.getAcmeState.mockReturnValue({
      managed: true,
      domain: 'afct.example.edu',
      staging: false,
    });

    const res = await POST(
      post({
        action: 'lets-encrypt',
        domain: 'afct.example.edu',
        email: 'admin@example.edu',
        staging: false,
      }),
      routeCtx(),
    );

    expect(res.status).toBe(200);
    expect(acme.requestCertificate).toHaveBeenCalledWith({
      domain: 'afct.example.edu',
      email: 'admin@example.edu',
      staging: false,
    });
    const body = await res.json();
    expect(body.acme).toEqual({ managed: true, domain: 'afct.example.edu', staging: false });
    const audit = lastAudit();
    expect(audit.action).toBe('TLS_CERT_INSTALLED');
    expect(audit.metadata.method).toBe('lets-encrypt');
    expect(audit.metadata.domain).toBe('afct.example.edu');
  });

  it('rejects a failed ACME order with 400 and logs TLS_CERT_REJECTED', async () => {
    authMock.mockResolvedValue(admin);
    acme.requestCertificate.mockRejectedValueOnce(new AcmeError('domain does not point here'));

    const res = await POST(
      post({ action: 'lets-encrypt', domain: 'bad.example.edu', email: 'a@example.edu' }),
      routeCtx(),
    );

    expect(res.status).toBe(400);
    const audit = lastAudit();
    expect(audit.action).toBe('TLS_CERT_REJECTED');
    expect(audit.metadata.reason).toBe('domain does not point here');
  });

  it('disables Let’s Encrypt auto-renewal and logs TLS_ACME_DISABLED', async () => {
    authMock.mockResolvedValue(admin);

    const res = await POST(post({ action: 'lets-encrypt-disable' }), routeCtx());

    expect(res.status).toBe(200);
    expect(acme.disableAcme).toHaveBeenCalled();
    expect(lastAudit().action).toBe('TLS_ACME_DISABLED');
  });

  it('logs "unknown error" when a non-Error value is thrown', async () => {
    authMock.mockResolvedValue(admin);
    tls.generateSelfSigned.mockImplementationOnce(() => {
      throw 'a plain string';
    });

    const res = await POST(post({ action: 'self-signed', commonName: 'x' }), routeCtx());

    expect(res.status).toBe(500);
    expect(lastAudit().metadata.error).toBe('unknown error');
  });
});
