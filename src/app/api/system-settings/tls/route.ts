import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import {
  readCertInfo,
  installCert,
  clearCert,
  hasPendingCsr,
  generateCsr,
  installSignedCert,
  generateSelfSigned,
  CertValidationError,
} from '@/lib/tls-cert';

async function requireAdmin() {
  const session = await auth();
  return session?.user?.role === 'ADMIN';
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
  if (!(await requireAdmin())) {
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
    switch (body.action) {
      case 'generate-csr': {
        const { csr } = generateCsr(csrFields);
        return NextResponse.json({ csr, ...readCertInfo(), pendingCsr: true });
      }
      case 'install-signed': {
        const info = installSignedCert(body.cert ?? '', body.chain);
        return NextResponse.json({ ...info, pendingCsr: hasPendingCsr() });
      }
      case 'self-signed': {
        const info = generateSelfSigned(csrFields);
        return NextResponse.json({ ...info, pendingCsr: hasPendingCsr() });
      }
      case 'install':
      default: {
        const info = installCert(body.cert ?? '', body.key ?? '', body.chain);
        return NextResponse.json({ ...info, pendingCsr: hasPendingCsr() });
      }
    }
  } catch (err) {
    if (err instanceof CertValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error('TLS action failed:', err);
    return NextResponse.json({ error: 'The certificate operation failed.' }, { status: 500 });
  }
}

export async function DELETE() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }
  return NextResponse.json({ ...clearCert(), pendingCsr: hasPendingCsr() });
}
