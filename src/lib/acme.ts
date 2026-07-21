// Let's Encrypt (ACME v2, HTTP-01) certificate issuance and renewal.
//
// This slots into the existing TLS pipeline: it obtains a certificate from an ACME
// CA and hands the fullchain + key to installCert() (src/lib/tls-cert.ts), which
// writes them to the app-owned cert volume that nginx polls and hot-reloads. The
// only extra moving part is the HTTP-01 challenge: the CA fetches
// http://<domain>/.well-known/acme-challenge/<token>, so we drop the token into a
// webroot volume that nginx serves over plain HTTP (see docker/nginx/default.conf).
//
// State persisted in the durable cert volume:
//   acme-account.key  the ACME account key (created once, reused)
//   acme.json         { domain, email, staging } — its presence means "LE-managed,
//                     auto-renew on".
//
// The previous certificate stays in place unless issuance succeeds, so a misconfigured
// domain (DNS not pointing here, port 80 blocked) never causes a TLS outage.

import fs from 'fs';
import path from 'path';
import * as acme from 'acme-client';
import { installCert, readCertInfo, type CertInfo } from '@/lib/tls-cert';

const CERT_DIR = process.env.TLS_CERT_DIR || '/app/certs';
const ACCOUNT_KEY_PATH = path.join(CERT_DIR, 'acme-account.key');
const CONFIG_PATH = path.join(CERT_DIR, 'acme.json');
const LOCK_PATH = path.join(CERT_DIR, '.acme.lock');

// nginx serves <webroot>/.well-known/acme-challenge/<token> over HTTP-01.
const WEBROOT_DIR = process.env.ACME_WEBROOT_DIR || '/app/acme-challenge';
const CHALLENGE_DIR = path.join(WEBROOT_DIR, '.well-known', 'acme-challenge');

// Renew when the installed cert is within this many days of expiry. Let's Encrypt
// certs last 90 days; 30 leaves a wide margin for retries.
export const RENEW_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

// A stale issuance lock older than this is ignored (a crashed prior attempt).
const LOCK_STALE_MS = 10 * 60 * 1000;

export class AcmeError extends Error {}

// Coarse issuance progress, written to a status file the admin UI polls while a request
// is in flight so it can show live steps instead of a bare spinner. Best-effort: writing
// it must never break issuance.
export type AcmeStatus = { phase: string; message?: string; updatedAt: string };

// Computed at call time (not a module const) so tests can point TLS_CERT_DIR at a temp dir.
function acmeStatusPath(): string {
  return path.join(process.env.TLS_CERT_DIR || '/app/certs', '.acme-status.json');
}

function writeAcmeStatus(phase: string, message?: string): void {
  try {
    fs.mkdirSync(path.dirname(acmeStatusPath()), { recursive: true });
    const status: AcmeStatus = { phase, message, updatedAt: new Date().toISOString() };
    fs.writeFileSync(acmeStatusPath(), `${JSON.stringify(status)}\n`, { mode: 0o600 });
  } catch {
    // best effort
  }
}

/** The most recent issuance progress, or null if none has been recorded. */
export function readAcmeStatus(): AcmeStatus | null {
  try {
    return JSON.parse(fs.readFileSync(acmeStatusPath(), 'utf8')) as AcmeStatus;
  } catch {
    return null;
  }
}

export type AcmeConfig = { domain: string; email: string; staging: boolean };
export type AcmeState = { managed: false } | ({ managed: true } & AcmeConfig);

// Conservative hostname check: a DNS name only (HTTP-01 cannot validate a bare IP,
// and Let's Encrypt does not issue for IPs). No wildcards (those need DNS-01).
function validateDomain(input: string): string {
  const domain = (input ?? '').trim().toLowerCase();
  if (
    !domain ||
    domain.length > 253 ||
    domain.includes('*') ||
    !/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(domain)
  ) {
    throw new AcmeError('Enter a valid public domain name (for example afct.example.edu).');
  }
  return domain;
}

function validateEmail(input: string): string {
  const email = (input ?? '').trim();
  if (!email || email.length > 254 || /\s/.test(email) || !/^[^@]+@[^@]+\.[^@]+$/.test(email)) {
    throw new AcmeError('Enter a valid contact email for the certificate.');
  }
  return email;
}

/** The stored Let's Encrypt configuration, or {managed:false} when none is set. */
export function getAcmeState(): AcmeState {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return { managed: false };
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as Partial<AcmeConfig>;
    if (!raw.domain || !raw.email) return { managed: false };
    return { managed: true, domain: raw.domain, email: raw.email, staging: Boolean(raw.staging) };
  } catch {
    return { managed: false };
  }
}

function writeConfig(config: AcmeConfig): void {
  fs.mkdirSync(CERT_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

/** Stop auto-renewal. The installed certificate is left untouched. */
export function disableAcme(): void {
  try {
    if (fs.existsSync(CONFIG_PATH)) fs.unlinkSync(CONFIG_PATH);
  } catch {
    // best effort
  }
}

// Reuse the account key across issuances so we don't register a new ACME account
// every time (that would eventually hit Let's Encrypt's account rate limit).
async function loadOrCreateAccountKey(): Promise<Buffer> {
  fs.mkdirSync(CERT_DIR, { recursive: true });
  if (fs.existsSync(ACCOUNT_KEY_PATH)) {
    return fs.readFileSync(ACCOUNT_KEY_PATH);
  }
  const key = await acme.crypto.createPrivateKey();
  fs.writeFileSync(ACCOUNT_KEY_PATH, key, { mode: 0o600 });
  return key;
}

// A single issuance at a time: a lockfile with a timestamp, ignored once stale.
function acquireLock(): void {
  fs.mkdirSync(CERT_DIR, { recursive: true });
  try {
    const raw = fs.readFileSync(LOCK_PATH, 'utf8');
    const ts = Number(raw);
    if (Number.isFinite(ts) && Date.now() - ts < LOCK_STALE_MS) {
      throw new AcmeError('A certificate request is already in progress. Please wait and retry.');
    }
  } catch (err) {
    if (err instanceof AcmeError) throw err;
    // No lock file (or unreadable): fall through and claim it.
  }
  fs.writeFileSync(LOCK_PATH, String(Date.now()), { mode: 0o600 });
}

function releaseLock(): void {
  try {
    if (fs.existsSync(LOCK_PATH)) fs.unlinkSync(LOCK_PATH);
  } catch {
    // best effort
  }
}

function writeChallenge(token: string, keyAuthorization: string): void {
  fs.mkdirSync(CHALLENGE_DIR, { recursive: true });
  // Token is a base64url string from the CA; guard against any path trickery.
  if (!/^[A-Za-z0-9_-]+$/.test(token)) throw new AcmeError('Invalid ACME challenge token.');
  fs.writeFileSync(path.join(CHALLENGE_DIR, token), keyAuthorization, { mode: 0o644 });
}

function removeChallenge(token: string): void {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(token)) return;
    const p = path.join(CHALLENGE_DIR, token);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch {
    // best effort
  }
}

/**
 * Obtain (or renew) a Let's Encrypt certificate for the domain via HTTP-01 and
 * install it. On success the stored config is updated so auto-renewal keeps it
 * current. Throws AcmeError with an admin-facing message on any failure; nothing
 * is installed unless the whole order succeeds.
 */
export async function requestCertificate(input: {
  domain: string;
  email: string;
  staging: boolean;
}): Promise<CertInfo> {
  const domain = validateDomain(input.domain);
  const email = validateEmail(input.email);
  const staging = Boolean(input.staging);

  acquireLock();
  try {
    writeAcmeStatus('starting', 'Preparing the certificate request…');
    const accountKey = await loadOrCreateAccountKey();
    const client = new acme.Client({
      directoryUrl: staging
        ? acme.directory.letsencrypt.staging
        : acme.directory.letsencrypt.production,
      accountKey,
    });

    const [certKey, csr] = await acme.crypto.createCsr({ commonName: domain, altNames: [domain] });

    writeAcmeStatus('requesting', 'Contacting Let’s Encrypt…');
    const cert = await client.auto({
      csr,
      email,
      termsOfServiceAgreed: true,
      challengePriority: ['http-01'],
      // Skip acme-client's own pre-flight fetch of the challenge URL. It resolves the
      // public hostname, which from a box behind NAT without hairpin/loopback routing
      // can't reach itself — the check would hang and the order would never be sent to
      // the CA. Let's Encrypt does the real reachability check from the internet anyway.
      skipChallengeVerification: true,
      challengeCreateFn: async (_authz, challenge, keyAuthorization) => {
        if (challenge.type !== 'http-01') {
          throw new AcmeError('Only the HTTP-01 challenge is supported.');
        }
        writeChallenge(challenge.token, keyAuthorization);
        writeAcmeStatus('validating', 'Waiting for Let’s Encrypt to validate your domain…');
      },
      challengeRemoveFn: async (_authz, challenge) => {
        removeChallenge(challenge.token);
      },
    });

    writeAcmeStatus('installing', 'Installing the certificate…');
    // client.auto returns the fullchain (leaf + intermediates); installCert writes
    // it verbatim and validates the leaf against the key.
    const info = installCert(cert.toString(), certKey.toString());
    writeConfig({ domain, email, staging });
    writeAcmeStatus('done', 'Certificate installed.');
    return info;
  } catch (err) {
    if (err instanceof AcmeError) {
      writeAcmeStatus('error', err.message);
      throw err;
    }
    const detail = err instanceof Error ? err.message : 'unknown error';
    const message = `Could not obtain a certificate for ${domain}. Confirm the domain points at this server and that port 80 is reachable from the internet. (${detail})`;
    writeAcmeStatus('error', message);
    throw new AcmeError(message);
  } finally {
    releaseLock();
  }
}

/**
 * If a Let's Encrypt certificate is configured and the installed cert is within the
 * renewal window (or already expired/missing), renew it. Returns what happened so the
 * caller (the scheduler) can log it. Never throws; renewal failures are reported.
 */
export async function renewIfNeeded(): Promise<
  { renewed: true; domain: string } | { renewed: false; reason: string }
> {
  const state = getAcmeState();
  if (!state.managed) return { renewed: false, reason: 'not-managed' };

  const info = readCertInfo();
  if (info.installed && info.validTo) {
    const expiry = new Date(info.validTo).getTime();
    if (Number.isFinite(expiry) && expiry - Date.now() > RENEW_WINDOW_DAYS * DAY_MS) {
      return { renewed: false, reason: 'not-due' };
    }
  }

  try {
    await requestCertificate(state);
    return { renewed: true, domain: state.domain };
  } catch (err) {
    return { renewed: false, reason: err instanceof Error ? err.message : 'renewal failed' };
  }
}

// Exposed for unit tests only.
export const __test__ = { validateDomain, validateEmail, CHALLENGE_DIR, CONFIG_PATH };
