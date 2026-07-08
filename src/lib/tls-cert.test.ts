import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

// Point the module at a throwaway cert dir *before* it is imported (the module
// resolves TLS_CERT_DIR at load time). installCert creates the dir as needed.
const CERT_DIR = vi.hoisted(() => {
  const base = process.env.TEMP || process.env.TMPDIR || '/tmp';
  const dir = `${base}/afct-tls-cert-test`;
  process.env.TLS_CERT_DIR = dir;
  return dir;
});

import {
  installCert,
  clearCert,
  readCertInfo,
  installSignedCert,
  buildSubjectAndSan,
  CertValidationError,
} from './tls-cert';

// --- Fixtures (generated with openssl; keys match their certs) ---------------

// Valid, long-lived, self-signed. Subject: CN=afct.test, O=AFCT Test.
const VALID_CERT = `-----BEGIN CERTIFICATE-----
MIIDSTCCAjGgAwIBAgIUCRuIdbLpWCY/fdFwMUoZ6yzwUxUwDQYJKoZIhvcNAQEL
BQAwKDESMBAGA1UEAwwJYWZjdC50ZXN0MRIwEAYDVQQKDAlBRkNUIFRlc3QwIBcN
MjYwNzAzMTI0NzIxWhgPMjEyNjA2MDkxMjQ3MjFaMCgxEjAQBgNVBAMMCWFmY3Qu
dGVzdDESMBAGA1UECgwJQUZDVCBUZXN0MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A
MIIBCgKCAQEAwMF3dQslOAcFF+e2KiKr7fm9laM5V4Hht8sWikURqxzxhrmipnvM
83QyrIUqJtaHCMP4BCbhRcL0nNEs1LTql3slF+QygeHMHcGmmwO9ov6Ub5LwZsgn
WXcUfTlepW6y6PxeV0ueFzbq79An1h963OQmCI8eU8zP7l7L+i9dLT9+7Ub2FORu
Wb0/wEs0TV/hjkVlaxJ6JriZXlTcQ5Q6+0d2+j4fkrTkaO34eupryjCFdLtpVIAR
99xjhhFNR7QMUWWVybDjXLsEa/4A8ZQMwamwZKIjuIEH1VCkyX4U30g7Z6naROTE
iqs4gRa7aFC/baT9BGEZrFmbV40CM8jFVQIDAQABo2kwZzAdBgNVHQ4EFgQU4Dvg
6CE/jZGZgSkJFRHZbk7nNkkwHwYDVR0jBBgwFoAU4Dvg6CE/jZGZgSkJFRHZbk7n
NkkwDwYDVR0TAQH/BAUwAwEB/zAUBgNVHREEDTALgglhZmN0LnRlc3QwDQYJKoZI
hvcNAQELBQADggEBAJM6QIWvjhiVtpuWRCmHliMIaygSoa1qff92ULWTxvjmk1so
o1XBYIkAtGJz0WdapuievzfvKKjfUm2dle5UBek1JMze6ejD4zWM4ehQPGbviC1J
WYk2tIelVGlzeaTg2vrvPK8YbE5imdwpYmYRzzwfo1unC6vDfh0+GzKF3AXmZEuW
Kld2rV03fnEKRPcxeDe660FxFGapkdjfu9TeFJNJY+F/IK/rKOQUyX2xQUZzPSG3
YVYCehQWr4eWZ5LazRB7txLqgnLZ5xvS9h62qDlBYFbWMHnoZxfrKHGg4o2huufK
Vt4zzyIOkvzyBFdhJz55r/1kLf/RKUBfT7neCC0=
-----END CERTIFICATE-----`;

const VALID_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvwIBADANBgkqhkiG9w0BAQEFAASCBKkwggSlAgEAAoIBAQDAwXd1CyU4BwUX
57YqIqvt+b2VozlXgeG3yxaKRRGrHPGGuaKme8zzdDKshSom1ocIw/gEJuFFwvSc
0SzUtOqXeyUX5DKB4cwdwaabA72i/pRvkvBmyCdZdxR9OV6lbrLo/F5XS54XNurv
0CfWH3rc5CYIjx5TzM/uXsv6L10tP37tRvYU5G5ZvT/ASzRNX+GORWVrEnomuJle
VNxDlDr7R3b6Ph+StORo7fh66mvKMIV0u2lUgBH33GOGEU1HtAxRZZXJsONcuwRr
/gDxlAzBqbBkoiO4gQfVUKTJfhTfSDtnqdpE5MSKqziBFrtoUL9tpP0EYRmsWZtX
jQIzyMVVAgMBAAECggEAD+AfTEGFvY6TydCTZ/cBErw4nsQZwJj5k99N1PI0A/7X
RFGyZrnYOyOShN5W3BSxJx9UzwAQxQ5118Xr8Pzm5rZawL6ntkYi6enSz1Od4SMh
6z/pPYiLTSAJ96JWUZPDd9Lz8Nv716JLSUMV9Nm/jxqEqLx43U1cwXTcoezCuiuA
L5wgHS2UckPAWo0kLmMSLPVGGloVqt4BC7mmZcLxzHTgZt1HGSTNkX7Wbr9KQRWe
/Lr9S1C2Zcn+pq+hbdcVsDuUW+bSr6XxWdAnvMJcfSdC5j4p3R7/otLZsH96D1G3
tU5tU4O8ZaKQftKsNN2PBzmRG1hxEVMgOPmyDHsyBQKBgQD0veIJBJI0HKERN38/
kfVAdYK6VvNBTkrM5fAAgKzcSM5jdeYNAzdtfqc5QREOvm718QQPKxFy5HhQO/BO
wITHDRv30NC5UuEBk3IPpwftxshWjZPkfhejlPKxfpWtuSIH1/G76cWkoMUL/W14
tVx6/rJV+99NRAkB6Had9soCpwKBgQDJn2Nr4ysmHu/CiuA4axPXVkji5zbzbdel
Zwy/VR+j6DVXEQvTdh7wRNw2JbyrZRWlmWheJatPpE/dsgOlkAeAPHcOet3sS++v
it4LtmziyQ+rcIeD29C7kxsJcNOSSVXhhptMwk5R0mR75/KJBmALWzSX2Dsklkdz
kNwqLZnjowKBgQCJ/XGvcfNZDHdH9Ml7NzlXYaoWlCXNQW5tPovmTKaqASbU70mJ
NrIOu2Vfo68RaA+5/W0zfC33YJfxbQod7PAwJtUJEaRNiUwyDkc2Sg/vYa/dFTA4
mVuMsNNxfhS4gXSNhZTXRYRZQQg4rWgGsgL1mhtE3aFWuDB38fDHOblGawKBgQCs
wljzSbxgNqPkAxEq5n0ixzk+yzVnkhf0Dv96NlsdG8wQpXeHoq/R2n8CGoW2KrBI
q9Ek0oweesFASdccFvSGacjt7FOZtFtVA91NFevoyrUVhh9n2YLaJqtFBJsUvqfK
zYbmV5u6OleFX/KOfJrxQB4pecr7h5UDrf0oWtiAlwKBgQCSnJ8smnz4K0JhHFRQ
uFx3nZTdjnKdVzs3RyxvfNOmJktDo9oBh/nKNeVsbuN8CvmchaFkz6KuBuoIFfSK
JJMwroiD7eKkYHY38EUIIsASkXb39oqp9lnI7WB+/JMPINWF6tWk5jIBX+bdM8lX
iIkGuC77SRCmJzmVTPiFKpD6jQ==
-----END PRIVATE KEY-----`;

// Expired (Jan 2020), CA-signed. Its key (EXPIRED_KEY) matches, so it clears the
// key-match guard and trips the expiry guard.
const EXPIRED_CERT = `-----BEGIN CERTIFICATE-----
MIICnjCCAYYCAhAAMA0GCSqGSIb3DQEBCwUAMBIxEDAOBgNVBAMMB1Rlc3QgQ0Ew
HhcNMjAwMTAxMDAwMDAwWhcNMjAwMTAyMDAwMDAwWjAXMRUwEwYDVQQDDAxleHBp
cmVkLnRlc3QwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDDsTDv5AZh
yP9yg3XV7uUdEF4huE182ICgHQxuv6GwNcs7h48J+yLSVURsJeDUxZyc1cicRjFt
Z+eWdNVHdfqAfB8hjfXowg10XxU0wfNxie0z/WXLZk+DXikIOlutKES/++GT4fIu
PDs2VUUgm3zdnldJ3GNN2r4Zuo3FPt2SPU6tNRKaqZ8gbL8jYMmlbkKGpzIQDLFA
P0YUFQaays8FQlCznXLx3A1x2WiauHhS8Lj+78NFob+6cqS+4HFZAW/MXG0P12Jl
w5t6XoFK/f0BAKMRpTy2/qrrgM3Cv9X76LxiiDdvUOEEz1NoX+4m2tHTLx9ob71E
oYcT2gJnFbYDAgMBAAEwDQYJKoZIhvcNAQELBQADggEBAE2QpJvuNCd20qRTtcOa
Ry4LAiHzMVgLHosO41hbt3WA6U4HcsyOIkVr9iFtiEXUBEXk+pXFE0ncWLCsn+lp
1JIYLLhyUacZsS6aasJi/NivDwUHhACst2voh0UkL/efutRG4NsoWOvoCfi0V/MS
3lHlzfgNmCByS1AFxjdqr0J95eSd5evPN+MEC9mXwHgaMMLUtQZnbV/wRvRvHrt5
9egBve1lbYbysgVQx40Lwjy8zJqvp/7OSM0mOMAC9ZvisqCktNbFTBEhX5BO8Aw+
IQlzle6+ft6+FnsCqUhZhsiK8pxY3qxj6IX7v79RDrPrKtaGGunUy8kP9XfwOdQF
sQ8=
-----END CERTIFICATE-----`;

const EXPIRED_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDDsTDv5AZhyP9y
g3XV7uUdEF4huE182ICgHQxuv6GwNcs7h48J+yLSVURsJeDUxZyc1cicRjFtZ+eW
dNVHdfqAfB8hjfXowg10XxU0wfNxie0z/WXLZk+DXikIOlutKES/++GT4fIuPDs2
VUUgm3zdnldJ3GNN2r4Zuo3FPt2SPU6tNRKaqZ8gbL8jYMmlbkKGpzIQDLFAP0YU
FQaays8FQlCznXLx3A1x2WiauHhS8Lj+78NFob+6cqS+4HFZAW/MXG0P12Jlw5t6
XoFK/f0BAKMRpTy2/qrrgM3Cv9X76LxiiDdvUOEEz1NoX+4m2tHTLx9ob71EoYcT
2gJnFbYDAgMBAAECggEAA8vyxpy2cPw81IRva1SktlEkemQAgN0UdcbKgHWQVgJd
LIz/PfLU5J7J4o1DlO02kiZlq36DI/vBlv4ySx4jW43M7tI5xKfLKghUOX9P0VKb
Owh+Cpm0Djjr8+Bp+eyPlOf2ou9dyv7ZKT8zRaQuooAZcnHnrVGCoa4oZPzIwLcO
GZx6aAKU9DD+e3ljD5RJrf6HZttFeGeVJaBy/hCeCBITSZ6xNwkEbN+n1NBCQOqx
up2ohecwl82Sc9zv9IrqgN/Gqkpkornx1pRYaMI/Yy/HNkP/IANIVLUTbbbRUqMp
Ut9bWnkaTLlBGnrOZLiRUwf3YyutfcEzpexy3ePq6QKBgQDjDG+UqWshnpp63as2
PdPoYZDrBVXXWuUOikCdGTGzcQiVn6VR/pDkXHL30snHMEVUAJ+wXAMLqVHzxrOl
wb+dAZxy5c2IAHlQOQch64YpZ3kvQhIJJpECYUmaoRJuPXMsoxMpyY3QB2bygP8r
16Gw6SEMwK3cUY+zOSGHzNLn2wKBgQDcpS9kRjXw0XXrL+P6F+dpfYhbGRMy87zC
0kqscq1Sm1n5JrKZmylxycgl/ZIQO1gC+wNv6vyG+AcrsojXxpjkc4PE/3GoPRt4
WZDBgPWINlZYuOHyOnne5ybDboncoREz7m7d9wKiShszWsMjP20QfESNCmY835oN
Nc5dvj42+QKBgHIzmxwnax9p60HJpYiO6LuF96J++IJt0bDSkVVzirA7NporxrfL
V43Fgn5so9lwyi5Kcgf+//kpnXMEiu/g2ERcvxh7xjmWI27agF/rW3wP88B1dyTr
JR0RWjhQtDiG6BuXmtf17UKptnpbr/2ZZFbbrCgB8nFTBPicz+TCfYLpAoGADGSW
ydoLs5AAQIp7EpP/InSzkPJSmr0H8CVhnlf+ljI1loHu7CPD6yk7Pa8FYjYDFn/E
zKd1MZuCw5iOiRgVhFdcolb6qklsXpEhSU0V/WWX6fnQbwuLxtJS4g02XxcI4VLW
FU+HbVgeOP8zEKrCVHe2Xfmkjmy8uVs5URibY/kCgYEAmSB/SeB6HJ2lidoRxfSB
7bIBbKNLh4aBUwxv3hrsYNOxAg1oUJhMd1EoLSc7w+Vp/JYhpMuIKggCl8xrM4zi
/kASGcoNCjCPMXwBpV6AI0cLB8/BH/Y/L33z/Gr16LJMiYErj/E94N7ieMMxt2jq
nvXtQYAf1s0XE9SFaZhtPzM=
-----END PRIVATE KEY-----`;

beforeEach(() => {
  fs.mkdirSync(CERT_DIR, { recursive: true });
  for (const f of fs.readdirSync(CERT_DIR)) {
    fs.rmSync(path.join(CERT_DIR, f), { force: true, recursive: true });
  }
});

afterAll(() => {
  fs.rmSync(CERT_DIR, { recursive: true, force: true });
});

describe('tls-cert install validation', () => {
  it('reports not installed when no cert file exists', () => {
    expect(readCertInfo()).toEqual({ installed: false });
  });

  it('requires both a certificate and a key', () => {
    expect(() => installCert('', '')).toThrow(CertValidationError);
    expect(() => installCert('something', '')).toThrow(/required/i);
  });

  it('rejects non-PEM input', () => {
    expect(() => installCert('not-a-pem', 'also-not-a-pem')).toThrow(CertValidationError);
  });

  it('rejects a private key that does not match the certificate', () => {
    expect(() => installCert(VALID_CERT, EXPIRED_KEY)).toThrow(/does not match/i);
  });

  it('rejects an expired certificate (even with a matching key)', () => {
    expect(() => installCert(EXPIRED_CERT, EXPIRED_KEY)).toThrow(/expired/i);
  });

  it('rejects an invalid certificate chain', () => {
    expect(() => installCert(VALID_CERT, VALID_KEY, 'garbage-not-a-pem-chain')).toThrow(
      /chain/i,
    );
  });

  it('installs a valid cert + matching key, then reads and clears it', () => {
    const info = installCert(VALID_CERT, VALID_KEY);
    expect(info.installed).toBe(true);
    expect(info.selfSigned).toBe(true);
    expect(info.expired).toBe(false);
    expect(info.subject).toContain('afct.test');

    // Files land in the cert dir; the key is written before the cert.
    expect(fs.existsSync(path.join(CERT_DIR, 'server.crt'))).toBe(true);
    expect(fs.existsSync(path.join(CERT_DIR, 'server.key'))).toBe(true);

    // readCertInfo reflects the installed cert...
    const read = readCertInfo();
    expect(read.installed).toBe(true);
    expect(read.subject).toContain('afct.test');

    // ...and clearCert reverts to the self-signed default.
    expect(clearCert()).toEqual({ installed: false });
    expect(readCertInfo()).toEqual({ installed: false });
  });

  it('refuses to install a signed cert when no CSR key is pending', () => {
    expect(() => installSignedCert(VALID_CERT)).toThrow(/pending key/i);
  });
});

describe('tls-cert CSR subject/SAN sanitization', () => {
  it('builds a subject and DNS SAN for a valid hostname', () => {
    const { subj, san } = buildSubjectAndSan({ commonName: 'afct.example.edu' });
    expect(subj).toBe('/CN=afct.example.edu');
    expect(san).toBe('DNS:afct.example.edu');
  });

  it('includes the organization in the subject', () => {
    const { subj } = buildSubjectAndSan({
      commonName: 'afct.example.edu',
      organization: 'Penn State Wilkes-Barre',
    });
    expect(subj).toBe('/CN=afct.example.edu/O=Penn State Wilkes-Barre');
  });

  it('classifies an IP common name as an IP SAN', () => {
    const { san } = buildSubjectAndSan({ commonName: '10.0.0.5' });
    expect(san).toBe('IP:10.0.0.5');
  });

  it('adds and de-duplicates alternative names', () => {
    const { san } = buildSubjectAndSan({
      commonName: 'afct.example.edu',
      altNames: ['afct.example.edu', 'www.example.edu', '10.0.0.5'],
    });
    expect(san).toBe('DNS:afct.example.edu,DNS:www.example.edu,IP:10.0.0.5');
  });

  it('requires a common name', () => {
    expect(() => buildSubjectAndSan({ commonName: '' })).toThrow(/required/i);
    expect(() => buildSubjectAndSan({ commonName: '   ' })).toThrow(/required/i);
  });

  it('rejects a common name that could inject openssl subject fields', () => {
    // A "/O=" or shell-ish payload must not survive as a valid hostname.
    expect(() => buildSubjectAndSan({ commonName: 'afct.test/O=Evil Corp' })).toThrow(
      /invalid hostname/i,
    );
    expect(() => buildSubjectAndSan({ commonName: 'a b; rm -rf /' })).toThrow(/invalid hostname/i);
    expect(() => buildSubjectAndSan({ commonName: 'foo\n-addext' })).toThrow(/invalid hostname/i);
  });

  it('rejects an alternative name that is not a valid host', () => {
    expect(() =>
      buildSubjectAndSan({ commonName: 'afct.test', altNames: ['bad name/O=x'] }),
    ).toThrow(/invalid hostname/i);
  });

  it('rejects an organization with invalid characters', () => {
    expect(() =>
      buildSubjectAndSan({ commonName: 'afct.test', organization: 'Evil/O=x' }),
    ).toThrow(/organization/i);
  });

  it('rejects an over-long organization', () => {
    expect(() =>
      buildSubjectAndSan({ commonName: 'afct.test', organization: 'A'.repeat(65) }),
    ).toThrow(/organization/i);
  });
});
