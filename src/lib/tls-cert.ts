// Server-side management of the custom TLS certificate.
//
// The app writes the uploaded cert/key to an app-owned volume (TLS_CERT_DIR).
// nginx mounts that volume read-only and, on a short poll, serves the custom
// cert if present or falls back to its auto-generated self-signed cert. Keeping
// the files in an app-owned volume avoids cross-container permission issues, and
// nginx (root) can always read them.

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { X509Certificate, createPrivateKey } from 'crypto';

const CERT_DIR = process.env.TLS_CERT_DIR || '/app/certs';
const CERT_PATH = path.join(CERT_DIR, 'server.crt');
const KEY_PATH = path.join(CERT_DIR, 'server.key');
// Key generated alongside a CSR, held until the signed cert comes back.
const PENDING_KEY = path.join(CERT_DIR, 'pending.key');
const PENDING_CSR = path.join(CERT_DIR, 'pending.csr');
const OPENSSL = process.env.OPENSSL_BIN || 'openssl';

export type CertInfo = {
  /** true when a custom cert is installed; false means nginx serves its self-signed default. */
  installed: boolean;
  subject?: string;
  issuer?: string;
  validFrom?: string;
  validTo?: string;
  /** true when issuer === subject (uploaded self-signed cert). */
  selfSigned?: boolean;
  expired?: boolean;
};

function describe(certPem: string): CertInfo {
  const cert = new X509Certificate(certPem);
  const validTo = new Date(cert.validTo);
  return {
    installed: true,
    subject: cert.subject,
    issuer: cert.issuer,
    validFrom: cert.validFrom,
    validTo: cert.validTo,
    selfSigned: cert.issuer === cert.subject,
    expired: Number.isFinite(validTo.getTime()) ? validTo.getTime() < Date.now() : undefined,
  };
}

/** Info about the currently-installed custom cert (or {installed:false} for the self-signed default). */
export function readCertInfo(): CertInfo {
  try {
    if (!fs.existsSync(CERT_PATH)) return { installed: false };
    return describe(fs.readFileSync(CERT_PATH, 'utf8'));
  } catch {
    // A corrupt file shouldn't crash the page; report as not installed.
    return { installed: false };
  }
}

export class CertValidationError extends Error {}

/**
 * Validate an uploaded cert + key (+ optional chain) and write them for nginx.
 * The leaf cert and any chain are concatenated into server.crt (fullchain).
 * Throws CertValidationError on any validation failure — nothing is written.
 */
export function installCert(certPem: string, keyPem: string, chainPem?: string): CertInfo {
  const cert = (certPem ?? '').trim();
  const key = (keyPem ?? '').trim();
  const chain = (chainPem ?? '').trim();

  if (!cert || !key) {
    throw new CertValidationError('Both a certificate and a private key are required.');
  }

  let x509: X509Certificate;
  try {
    x509 = new X509Certificate(cert);
  } catch {
    throw new CertValidationError('The certificate is not valid PEM.');
  }

  let keyObj;
  try {
    keyObj = createPrivateKey(key);
  } catch {
    throw new CertValidationError('The private key is not valid PEM.');
  }

  if (!x509.checkPrivateKey(keyObj)) {
    throw new CertValidationError('The private key does not match the certificate.');
  }

  const validTo = new Date(x509.validTo);
  if (Number.isFinite(validTo.getTime()) && validTo.getTime() < Date.now()) {
    throw new CertValidationError('The certificate has already expired.');
  }

  if (chain) {
    try {
      new X509Certificate(chain.split('-----END CERTIFICATE-----')[0] + '-----END CERTIFICATE-----');
    } catch {
      throw new CertValidationError('The certificate chain is not valid PEM.');
    }
  }

  fs.mkdirSync(CERT_DIR, { recursive: true });
  const fullchain = chain ? `${cert}\n${chain}\n` : `${cert}\n`;
  // Write key first with strict perms, then the cert.
  fs.writeFileSync(KEY_PATH, `${key}\n`, { mode: 0o600 });
  fs.writeFileSync(CERT_PATH, fullchain, { mode: 0o644 });

  return describe(cert);
}

/** Remove the custom cert so nginx reverts to its self-signed default. */
export function clearCert(): CertInfo {
  try {
    if (fs.existsSync(CERT_PATH)) fs.unlinkSync(CERT_PATH);
    if (fs.existsSync(KEY_PATH)) fs.unlinkSync(KEY_PATH);
  } catch {
    // ignore; report current state below
  }
  return { installed: false };
}

/* ---------------- Key + CSR generation (via openssl) ---------------- */

export type CsrFields = { commonName: string; organization?: string; altNames?: string[] };

/** True when a CSR was generated and we're waiting for the signed cert. */
export function hasPendingCsr(): boolean {
  return fs.existsSync(PENDING_KEY);
}

// A subject value like organization: allow a conservative set of characters.
function cleanSubjectValue(v: string | undefined): string {
  const t = (v ?? '').trim();
  if (!t) return '';
  if (t.length > 64 || !/^[A-Za-z0-9 ._-]+$/.test(t)) {
    throw new CertValidationError('Organization contains invalid characters.');
  }
  return t;
}

// A hostname or IP used in CN / SAN.
function cleanHost(v: string | undefined): string {
  const t = (v ?? '').trim();
  if (!t) return '';
  const isIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(t) || /^[0-9a-fA-F:]+:[0-9a-fA-F:]+$/.test(t);
  const isDns = t.length <= 253 && /^(\*\.)?([A-Za-z0-9-]+\.)*[A-Za-z0-9-]+$/.test(t);
  if (!isIp && !isDns) {
    throw new CertValidationError(`Invalid hostname or IP: ${t}`);
  }
  return t;
}

function sanEntry(host: string): string {
  const isIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(host) || /^[0-9a-fA-F:]+:[0-9a-fA-F:]+$/.test(host);
  return isIp ? `IP:${host}` : `DNS:${host}`;
}

// Exported for unit testing of the input sanitization (injection guards).
export function buildSubjectAndSan(fields: CsrFields): { subj: string; san: string } {
  const cn = cleanHost(fields.commonName);
  if (!cn) throw new CertValidationError('A hostname (Common Name) is required.');
  const org = cleanSubjectValue(fields.organization);

  const parts = [`/CN=${cn}`];
  if (org) parts.push(`/O=${org}`);

  const hosts = new Set<string>([cn]);
  for (const a of fields.altNames ?? []) {
    const h = cleanHost(a);
    if (h) hosts.add(h);
  }
  const san = Array.from(hosts).map(sanEntry).join(',');
  return { subj: parts.join(''), san };
}

/**
 * Generate a fresh private key + CSR. The key is stored (pending) until the
 * signed certificate is uploaded; the CSR is returned for sending to a CA.
 */
export function generateCsr(fields: CsrFields): { csr: string } {
  const { subj, san } = buildSubjectAndSan(fields);
  fs.mkdirSync(CERT_DIR, { recursive: true });

  execFileSync(
    OPENSSL,
    [
      'req', '-new', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', PENDING_KEY,
      '-out', PENDING_CSR,
      '-subj', subj,
      '-addext', `subjectAltName=${san}`,
    ],
    { stdio: 'ignore' },
  );
  fs.chmodSync(PENDING_KEY, 0o600);

  return { csr: fs.readFileSync(PENDING_CSR, 'utf8') };
}

/** Pair an uploaded CA-signed certificate with the pending key and install it. */
export function installSignedCert(certPem: string, chainPem?: string): CertInfo {
  if (!fs.existsSync(PENDING_KEY)) {
    throw new CertValidationError('No pending key found. Generate a CSR first.');
  }
  const key = fs.readFileSync(PENDING_KEY, 'utf8');
  const info = installCert(certPem, key, chainPem); // validates match + expiry, then writes
  try {
    fs.unlinkSync(PENDING_KEY);
  } catch {
    // best-effort cleanup
  }
  try {
    fs.unlinkSync(PENDING_CSR);
  } catch {
    // best-effort cleanup
  }
  return info;
}

/** One-click: generate a self-signed key + cert for a hostname and install it. */
export function generateSelfSigned(fields: CsrFields): CertInfo {
  const { subj, san } = buildSubjectAndSan(fields);
  fs.mkdirSync(CERT_DIR, { recursive: true });

  const tmpKey = path.join(CERT_DIR, '.selfsigned.key');
  const tmpCrt = path.join(CERT_DIR, '.selfsigned.crt');
  try {
    execFileSync(
      OPENSSL,
      [
        'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
        '-keyout', tmpKey,
        '-out', tmpCrt,
        '-days', '825',
        '-subj', subj,
        '-addext', `subjectAltName=${san}`,
      ],
      { stdio: 'ignore' },
    );
    const cert = fs.readFileSync(tmpCrt, 'utf8');
    const key = fs.readFileSync(tmpKey, 'utf8');
    return installCert(cert, key);
  } finally {
    try {
      if (fs.existsSync(tmpKey)) fs.unlinkSync(tmpKey);
    } catch {
      /* ignore */
    }
    try {
      if (fs.existsSync(tmpCrt)) fs.unlinkSync(tmpCrt);
    } catch {
      /* ignore */
    }
  }
}
