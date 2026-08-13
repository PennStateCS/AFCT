import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getPublicAppUrl, publicAppUrl, PublicUrlError } from './public-app-url';

/**
 * The address AFCT puts in outbound links.
 *
 * The failure this guards against is quiet: with nothing configured, the reset email used to go
 * out carrying `/reset-password?token=...`, which reads as a link in a code editor and as
 * nothing at all in a mail client. Somebody locked out then waits for an email that arrived and
 * cannot be used.
 */

const original = process.env.NEXTAUTH_URL;

beforeEach(() => {
  delete process.env.NEXTAUTH_URL;
});

afterEach(() => {
  if (original === undefined) delete process.env.NEXTAUTH_URL;
  else process.env.NEXTAUTH_URL = original;
});

describe('an address AFCT can build links on', () => {
  it('accepts an https address', () => {
    process.env.NEXTAUTH_URL = 'https://afct.example.edu';

    expect(getPublicAppUrl()).toEqual({ ok: true, origin: 'https://afct.example.edu' });
  });

  // Trailing slashes are how a configured value and a path end up with two between them.
  it('trims trailing slashes so a path can simply be appended', () => {
    process.env.NEXTAUTH_URL = 'https://afct.example.edu/';

    expect(publicAppUrl('/reset-password?token=abc')).toBe(
      'https://afct.example.edu/reset-password?token=abc',
    );
  });

  // AFCT can live under a path when it shares a hostname with something else.
  it('keeps a path prefix', () => {
    process.env.NEXTAUTH_URL = 'https://example.edu/afct';

    expect(publicAppUrl('/reset-password')).toBe('https://example.edu/afct/reset-password');
  });

  // Somebody running AFCT on their own machine. The token never leaves it.
  it('accepts plain http against localhost', () => {
    process.env.NEXTAUTH_URL = 'http://localhost:3000';

    expect(getPublicAppUrl()).toEqual({ ok: true, origin: 'http://localhost:3000' });
  });
});

describe('an address AFCT will not send links on', () => {
  it('refuses a missing one', () => {
    expect(getPublicAppUrl()).toMatchObject({ ok: false, problem: 'missing' });
  });

  it('refuses a blank one', () => {
    process.env.NEXTAUTH_URL = '   ';

    expect(getPublicAppUrl()).toMatchObject({ ok: false, problem: 'missing' });
  });

  // A hostname on its own is not a URL, and produces a link nobody can open.
  it('refuses one that is not absolute', () => {
    process.env.NEXTAUTH_URL = 'afct.example.edu';

    expect(getPublicAppUrl()).toMatchObject({ ok: false, problem: 'malformed' });
  });

  it('refuses gibberish', () => {
    process.env.NEXTAUTH_URL = 'ht!tp:// not a url';

    expect(getPublicAppUrl()).toMatchObject({ ok: false, problem: 'malformed' });
  });

  /**
   * A `javascript:` or `file:` URL in an outbound email is a good deal worse than a broken one,
   * and the scheme is read from configuration rather than being fixed, so it is worth refusing
   * explicitly rather than assuming nobody would.
   */
  it('refuses a scheme a mail client will not follow', () => {
    process.env.NEXTAUTH_URL = 'ftp://afct.example.edu';

    expect(getPublicAppUrl()).toMatchObject({ ok: false, problem: 'unsupported-scheme' });
  });

  it('refuses javascript', () => {
    process.env.NEXTAUTH_URL = 'javascript:alert(1)';

    expect(getPublicAppUrl()).toMatchObject({ ok: false, problem: 'unsupported-scheme' });
  });

  /**
   * Plain HTTP to a real host means the reset token crosses a network in clear text, and the
   * token is the whole account for as long as it lasts.
   */
  it('refuses plain http to a real host', () => {
    process.env.NEXTAUTH_URL = 'http://afct.example.edu';

    expect(getPublicAppUrl()).toMatchObject({ ok: false, problem: 'insecure' });
  });

  // Throws rather than returning something relative, so a caller cannot forget to check.
  it('throws rather than building a relative link', () => {
    expect(() => publicAppUrl('/reset-password')).toThrow(PublicUrlError);
  });

  // Every message is for an administrator, so each has to say what to change.
  it('says what to do about it', () => {
    process.env.NEXTAUTH_URL = 'http://afct.example.edu';
    const result = getPublicAppUrl();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('NEXTAUTH_URL');
  });
});
