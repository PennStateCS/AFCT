import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog, type EnhancedActivityLogData } from '@/lib/activity-log-utils';
import { withAdminAuth } from '@/lib/api/with-auth';
import { readJson } from '@/lib/api/request';
import {
  readCertInfo,
  installCert,
  clearCert,
  hasPendingCsr,
  generateCsr,
  installSignedCert,
  generateSelfSigned,
  CertValidationError,
  type CertInfo,
} from '@/lib/tls-cert';
import { requestCertificate, disableAcme, getAcmeState, AcmeError } from '@/lib/acme';

// Audit logging must never break a certificate operation, so swallow its errors.
async function safeAuditLog(req: Request, data: EnhancedActivityLogData): Promise<void> {
  try {
    await createEnhancedActivityLog(prisma, req, data);
  } catch (err) {
    console.error('[tls] audit log failed:', err);
  }
}

// Non-sensitive certificate details safe to record. Never the key or PEM bodies.
function certMeta(info: CertInfo) {
  return {
    subject: info.subject ?? null,
    issuer: info.issuer ?? null,
    validTo: info.validTo ?? null,
    selfSigned: info.selfSigned ?? null,
  };
}

/**
 * Returns metadata about the currently installed TLS certificate and whether a
 * CSR is awaiting a signed cert. Admin only. Never returns key or PEM material.
 * @openapi
 * summary: Get TLS certificate status
 * responses:
 *   200:
 *     description: Certificate metadata and pending-CSR flag.
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             subject: { type: string, nullable: true }
 *             issuer: { type: string, nullable: true }
 *             validTo: { type: string, nullable: true }
 *             selfSigned: { type: boolean, nullable: true }
 *             pendingCsr: { type: boolean }
 *             acme:
 *               type: object
 *               description: Let's Encrypt auto-renewal state (managed=false when not configured).
 *               properties:
 *                 managed: { type: boolean }
 *                 domain: { type: string }
 *                 email: { type: string }
 *                 staging: { type: boolean }
 *   403: { description: Caller is not an admin. }
 */
export const GET = withAdminAuth(
  () => NextResponse.json({ ...readCertInfo(), pendingCsr: hasPendingCsr(), acme: getAcmeState() }),
  { deniedAction: 'TLS_STATUS_VIEW_DENIED' },
);

const TlsCertRequestSchema = z.object({
  action: z
    .enum([
      'install',
      'generate-csr',
      'install-signed',
      'self-signed',
      'lets-encrypt',
      'lets-encrypt-disable',
    ])
    .optional(),
  cert: z.string().optional(),
  key: z.string().optional(),
  chain: z.string().optional(),
  commonName: z.string().optional(),
  organization: z.string().optional(),
  altNames: z.array(z.string()).optional(),
  // Let's Encrypt fields.
  domain: z.string().optional(),
  email: z.string().optional(),
  staging: z.boolean().optional(),
});

/**
 * Performs a certificate operation, chosen by the `action` field. Admin only;
 * unauthorized-but-authenticated attempts are recorded as a security event. Cert
 * bodies and keys are accepted in the request but never echoed back or logged.
 * @openapi
 * summary: Install or generate a TLS certificate
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         properties:
 *           action:
 *             type: string
 *             enum: [install, generate-csr, install-signed, self-signed, lets-encrypt, lets-encrypt-disable]
 *             description: >-
 *               install (default) = upload cert+key; generate-csr = create a CSR to
 *               be signed externally; install-signed = install the cert returned for
 *               a pending CSR; self-signed = generate a self-signed cert; lets-encrypt
 *               = obtain a free auto-renewing cert via ACME HTTP-01; lets-encrypt-disable
 *               = turn off auto-renewal (leaves the current cert in place).
 *           cert: { type: string, description: PEM cert (install / install-signed) }
 *           key: { type: string, description: PEM private key (install) }
 *           chain: { type: string, description: Optional intermediate chain }
 *           commonName: { type: string, description: CSR/self-signed subject CN }
 *           organization: { type: string }
 *           altNames: { type: array, items: { type: string } }
 *           domain: { type: string, description: Public domain for lets-encrypt (must resolve to this server) }
 *           email: { type: string, description: Contact email for lets-encrypt }
 *           staging: { type: boolean, description: Use the Let's Encrypt staging CA for testing }
 * responses:
 *   200:
 *     description: The resulting certificate metadata (plus `csr` for generate-csr).
 *   400: { description: "Invalid JSON, or the certificate/key was rejected by validation." }
 *   403: { description: Caller is not an admin. }
 *   500: { description: The certificate operation failed. }
 */
export const POST = withAdminAuth(
  async (req, _ctx, { user }) => {
    const parsed = await readJson(req, TlsCertRequestSchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const csrFields = {
      commonName: body.commonName ?? '',
      organization: body.organization,
      altNames: Array.isArray(body.altNames) ? body.altNames : undefined,
    };

    try {
      let responseBody: Record<string, unknown>;
      let auditAction: string;
      let auditMeta: EnhancedActivityLogData['metadata'];

      switch (body.action) {
        case 'generate-csr': {
          const { csr } = generateCsr(csrFields);
          responseBody = { csr, ...readCertInfo(), pendingCsr: true };
          auditAction = 'TLS_CSR_GENERATED';
          auditMeta = {
            commonName: csrFields.commonName,
            organization: csrFields.organization ?? null,
            altNames: csrFields.altNames ?? [],
          };
          break;
        }
        case 'install-signed': {
          const info = installSignedCert(body.cert ?? '', body.chain);
          responseBody = { ...info, pendingCsr: hasPendingCsr() };
          auditAction = 'TLS_CERT_INSTALLED';
          auditMeta = { method: 'csr-signed', ...certMeta(info) };
          break;
        }
        case 'self-signed': {
          const info = generateSelfSigned(csrFields);
          responseBody = { ...info, pendingCsr: hasPendingCsr() };
          auditAction = 'TLS_CERT_INSTALLED';
          auditMeta = { method: 'self-signed', ...certMeta(info) };
          break;
        }
        case 'lets-encrypt': {
          const info = await requestCertificate({
            domain: body.domain ?? '',
            email: body.email ?? '',
            staging: body.staging ?? false,
          });
          responseBody = { ...info, pendingCsr: hasPendingCsr(), acme: getAcmeState() };
          auditAction = 'TLS_CERT_INSTALLED';
          // The domain/email are non-sensitive and already stored; the key is never touched.
          auditMeta = {
            method: 'lets-encrypt',
            domain: body.domain ?? null,
            staging: body.staging ?? false,
            ...certMeta(info),
          };
          break;
        }
        case 'lets-encrypt-disable': {
          disableAcme();
          responseBody = { ...readCertInfo(), pendingCsr: hasPendingCsr(), acme: getAcmeState() };
          auditAction = 'TLS_ACME_DISABLED';
          auditMeta = { method: 'lets-encrypt' };
          break;
        }
        case 'install':
        default: {
          const info = installCert(body.cert ?? '', body.key ?? '', body.chain);
          responseBody = { ...info, pendingCsr: hasPendingCsr() };
          auditAction = 'TLS_CERT_INSTALLED';
          auditMeta = { method: 'upload', ...certMeta(info) };
          break;
        }
      }

      await safeAuditLog(req, {
        userId: user.id,
        action: auditAction,
        // CSR generation and every cert install are routine operations.
        severity: 'INFO',
        category: 'SYSTEM',
        metadata: auditMeta,
      });
      return NextResponse.json(responseBody);
    } catch (err) {
      if (err instanceof CertValidationError || err instanceof AcmeError) {
        // A rejected certificate or a failed ACME order is a meaningful operational
        // event; the message is an admin-facing reason (e.g. "key does not match", or
        // "domain does not point here"), never key material.
        await safeAuditLog(req, {
          userId: user.id,
          action: 'TLS_CERT_REJECTED',
          severity: 'WARNING',
          category: 'SYSTEM',
          metadata: { attempted: body.action ?? 'install', reason: err.message },
        });
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      console.error('TLS action failed:', err);
      await safeAuditLog(req, {
        userId: user.id,
        action: 'TLS_CERT_ERROR',
        severity: 'ERROR',
        category: 'SYSTEM',
        metadata: {
          attempted: body.action ?? 'install',
          error: err instanceof Error ? err.message : 'unknown error',
        },
      });
      return NextResponse.json({ error: 'The certificate operation failed.' }, { status: 500 });
    }
  },
  { deniedAction: 'TLS_UPDATE_DENIED' },
);

/**
 * Removes the installed certificate and reverts to a self-signed one. Admin only.
 * @openapi
 * summary: Reset TLS to a self-signed certificate
 * responses:
 *   200:
 *     description: Certificate reset; returns the new (self-signed) metadata.
 *   403: { description: Caller is not an admin. }
 */
export const DELETE = withAdminAuth(
  async (req, _ctx, { user }) => {
    const result = clearCert();
    await safeAuditLog(req, {
      userId: user.id,
      action: 'TLS_CERT_RESET',
      category: 'SYSTEM',
      severity: 'INFO',
      metadata: { revertedTo: 'self-signed' },
    });
    return NextResponse.json({ ...result, pendingCsr: hasPendingCsr() });
  },
  { deniedAction: 'TLS_UPDATE_DENIED' },
);
