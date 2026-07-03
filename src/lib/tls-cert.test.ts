import { describe, it, expect } from 'vitest';
import { installCert, readCertInfo, CertValidationError } from './tls-cert';

// Happy-path (valid cert+key, expiry, hot-reload) is verified end-to-end against
// the real nginx container. These cover the pure validation guards.

describe('tls-cert', () => {
  it('reports not installed when no cert file exists', () => {
    // TLS_CERT_DIR defaults to /app/certs, which does not exist in the test env.
    expect(readCertInfo()).toEqual({ installed: false });
  });

  it('requires both a certificate and a key', () => {
    expect(() => installCert('', '')).toThrow(CertValidationError);
    expect(() => installCert('something', '')).toThrow(/required/i);
  });

  it('rejects non-PEM input', () => {
    expect(() => installCert('not-a-pem', 'also-not-a-pem')).toThrow(CertValidationError);
  });
});
