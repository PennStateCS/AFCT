import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  createEnhancedActivityLog,
  type EnhancedActivityLogData,
} from '@/lib/activity-log-utils';
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

async function requireAdmin() {
  const session = await auth();
  return session?.user?.role === 'ADMIN';
}

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

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }
  return NextResponse.json({ ...readCertInfo(), pendingCsr: hasPendingCsr() });
}

type Body = {
  action?: 'install' | 'generate-csr' | 'install-signed' | 'self-signed';
  cert?: string;
  key?: string;
  chain?: string;
  commonName?: string;
  organization?: string;
  altNames?: string[];
};

export async function POST(req: Request) {
  const session = await auth();
  if (session?.user?.role !== 'ADMIN') {
    // Trail authenticated-but-unauthorized attempts to change the server certificate.
    if (session?.user?.id) {
      await safeAuditLog(req, {
        userId: session.user.id,
        action: 'TLS_UPDATE_DENIED',
        severity: 'SECURITY',
        category: 'SYSTEM',
        metadata: { role: session.user.role ?? null },
      });
    }
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

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
      userId: session.user.id,
      action: auditAction,
      // CSR generation and every cert install are routine operations.
      severity: 'INFO',
      category: 'SYSTEM',
      metadata: auditMeta,
    });
    return NextResponse.json(responseBody);
  } catch (err) {
    if (err instanceof CertValidationError) {
      // A rejected certificate is a meaningful operational event; the message is a
      // validation reason (e.g. "key does not match"), never key material.
      await safeAuditLog(req, {
        userId: session.user.id,
        action: 'TLS_CERT_REJECTED',
        severity: 'WARNING',
        category: 'SYSTEM',
        metadata: { attempted: body.action ?? 'install', reason: err.message },
      });
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error('TLS action failed:', err);
    await safeAuditLog(req, {
      userId: session.user.id,
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
}

export async function DELETE(req: Request) {
  const session = await auth();
  if (session?.user?.role !== 'ADMIN') {
    if (session?.user?.id) {
      await safeAuditLog(req, {
        userId: session.user.id,
        action: 'TLS_UPDATE_DENIED',
        severity: 'SECURITY',
        category: 'SYSTEM',
        metadata: { role: session.user.role ?? null, attempted: 'reset' },
      });
    }
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const result = clearCert();
  await safeAuditLog(req, {
    userId: session.user.id,
    action: 'TLS_CERT_RESET',
    category: 'SYSTEM',
    metadata: { revertedTo: 'self-signed' },
  });
  return NextResponse.json({ ...result, pendingCsr: hasPendingCsr() });
}
