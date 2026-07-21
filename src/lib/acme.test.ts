import { beforeEach, describe, expect, it, vi } from 'vitest';

// A real temp dir for the account key / config / challenge files, and a place to
// capture what the challenge callback wrote mid-order. Hoisted so it's set before the
// module under test (which reads these env vars at import) is loaded.
const h = vi.hoisted(() => {
  const os = require('os');
  const path = require('path');
  const fs = require('fs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afct-acme-'));
  process.env.TLS_CERT_DIR = dir;
  process.env.ACME_WEBROOT_DIR = path.join(dir, 'webroot');
  return {
    dir,
    webroot: path.join(dir, 'webroot'),
    captured: { challenge: null as string | null },
  };
});

const { installCertMock, readCertInfoMock } = vi.hoisted(() => ({
  installCertMock: vi.fn(() => ({ installed: true, subject: 'CN=test', validTo: 'far' })),
  readCertInfoMock: vi.fn(() => ({ installed: false }) as Record<string, unknown>),
}));

vi.mock('@/lib/tls-cert', () => ({
  installCert: installCertMock,
  readCertInfo: readCertInfoMock,
}));

vi.mock('acme-client', () => ({
  crypto: {
    createPrivateKey: vi.fn(async () => Buffer.from('ACCOUNT_KEY')),
    createCsr: vi.fn(async () => [Buffer.from('CERT_KEY'), Buffer.from('CSR')]),
  },
  directory: {
    letsencrypt: { staging: 'https://staging.example', production: 'https://prod.example' },
  },
  Client: class {
    async auto(opts: {
      challengeCreateFn: (
        a: unknown,
        c: { type: string; token: string },
        k: string,
      ) => Promise<void>;
      challengeRemoveFn: (
        a: unknown,
        c: { type: string; token: string },
        k: string,
      ) => Promise<void>;
    }) {
      const fs = require('fs');
      const path = require('path');
      const challenge = { type: 'http-01', token: 'tok_123' };
      await opts.challengeCreateFn({}, challenge, 'KEY_AUTH_VALUE');
      // Capture what the app wrote to the webroot before it's cleaned up.
      const p = path.join(h.webroot, '.well-known', 'acme-challenge', 'tok_123');
      h.captured.challenge = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
      await opts.challengeRemoveFn({}, challenge, 'KEY_AUTH_VALUE');
      return 'FULLCHAIN_PEM';
    }
  },
}));

import fs from 'fs';
import path from 'path';
import {
  requestCertificate,
  renewIfNeeded,
  getAcmeState,
  disableAcme,
  readAcmeStatus,
  AcmeError,
  __test__,
} from './acme';

const CONFIG_PATH = path.join(h.dir, 'acme.json');

beforeEach(() => {
  vi.clearAllMocks();
  installCertMock.mockReturnValue({ installed: true, subject: 'CN=test', validTo: 'far' });
  readCertInfoMock.mockReturnValue({ installed: false });
  // Clean state between tests.
  for (const f of ['acme.json', 'acme-account.key', '.acme.lock', '.acme-status.json']) {
    const p = path.join(h.dir, f);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  h.captured.challenge = null;
});

describe('validateDomain', () => {
  it('accepts a normal domain and lowercases it', () => {
    expect(__test__.validateDomain('AFCT.Example.EDU')).toBe('afct.example.edu');
  });

  it('rejects wildcards, bare IPs, and junk', () => {
    for (const bad of ['*.example.edu', '10.0.0.5', 'localhost', 'no dots', '']) {
      expect(() => __test__.validateDomain(bad)).toThrow(AcmeError);
    }
  });
});

describe('validateEmail', () => {
  it('accepts a valid email', () => {
    expect(__test__.validateEmail('admin@example.edu')).toBe('admin@example.edu');
  });

  it('rejects malformed emails', () => {
    for (const bad of ['no-at', 'a@b', 'a b@c.com', '']) {
      expect(() => __test__.validateEmail(bad)).toThrow(AcmeError);
    }
  });
});

describe('requestCertificate', () => {
  it('runs the order, writes the challenge, installs the fullchain, and stores config', async () => {
    const info = await requestCertificate({
      domain: 'afct.example.edu',
      email: 'admin@example.edu',
      staging: true,
    });

    // The HTTP-01 token was written to the webroot during the order.
    expect(h.captured.challenge).toBe('KEY_AUTH_VALUE');
    // The fullchain + cert key were handed to installCert.
    expect(installCertMock).toHaveBeenCalledWith('FULLCHAIN_PEM', 'CERT_KEY');
    expect(info.installed).toBe(true);

    // Config persisted → managed with auto-renew on; challenge file cleaned up.
    const state = getAcmeState();
    expect(state).toEqual({
      managed: true,
      domain: 'afct.example.edu',
      email: 'admin@example.edu',
      staging: true,
    });
    expect(fs.existsSync(path.join(h.webroot, '.well-known', 'acme-challenge', 'tok_123'))).toBe(
      false,
    );
  });

  it('rejects an invalid domain before contacting the CA', async () => {
    await expect(
      requestCertificate({ domain: '*.example.edu', email: 'admin@example.edu', staging: false }),
    ).rejects.toThrow(AcmeError);
    expect(installCertMock).not.toHaveBeenCalled();
    expect(getAcmeState().managed).toBe(false);
  });
});

describe('readAcmeStatus', () => {
  it('is null before any issuance has run', () => {
    expect(readAcmeStatus()).toBeNull();
  });

  it("records a 'done' phase after a successful issuance", async () => {
    await requestCertificate({
      domain: 'afct.example.edu',
      email: 'admin@example.edu',
      staging: true,
    });
    const status = readAcmeStatus();
    expect(status?.phase).toBe('done');
    expect(status?.updatedAt).toBeTruthy();
  });
});

describe('getAcmeState / disableAcme', () => {
  it('reports not-managed when no config exists', () => {
    expect(getAcmeState()).toEqual({ managed: false });
  });

  it('disableAcme removes the config but leaves the cert', () => {
    fs.writeFileSync(
      CONFIG_PATH,
      JSON.stringify({ domain: 'x.example.edu', email: 'a@example.edu', staging: false }),
    );
    expect(getAcmeState().managed).toBe(true);
    disableAcme();
    expect(getAcmeState().managed).toBe(false);
  });
});

describe('renewIfNeeded', () => {
  it('does nothing when not managed', async () => {
    expect(await renewIfNeeded()).toEqual({ renewed: false, reason: 'not-managed' });
    expect(installCertMock).not.toHaveBeenCalled();
  });

  it('skips renewal when the cert is far from expiry', async () => {
    fs.writeFileSync(
      CONFIG_PATH,
      JSON.stringify({ domain: 'x.example.edu', email: 'a@example.edu', staging: false }),
    );
    const far = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
    readCertInfoMock.mockReturnValue({ installed: true, validTo: far });

    expect(await renewIfNeeded()).toEqual({ renewed: false, reason: 'not-due' });
    expect(installCertMock).not.toHaveBeenCalled();
  });

  it('renews when the cert is within the renewal window', async () => {
    fs.writeFileSync(
      CONFIG_PATH,
      JSON.stringify({ domain: 'x.example.edu', email: 'a@example.edu', staging: false }),
    );
    const soon = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
    readCertInfoMock.mockReturnValue({ installed: true, validTo: soon });

    const result = await renewIfNeeded();
    expect(result).toEqual({ renewed: true, domain: 'x.example.edu' });
    expect(installCertMock).toHaveBeenCalledWith('FULLCHAIN_PEM', 'CERT_KEY');
  });
});
