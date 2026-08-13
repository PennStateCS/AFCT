import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  systemSettings: { findUnique: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

const sendMailMock = vi.hoisted(() => vi.fn());
const createTransportMock = vi.hoisted(() => vi.fn(() => ({ sendMail: sendMailMock })));
vi.mock('nodemailer', () => ({ default: { createTransport: createTransportMock } }));

import {
  canSendPasswordReset,
  getSmtpConfig,
  isMailConfigured,
  isRetryableMailFailure,
  MailError,
  sendMail,
  sendTestEmail,
} from './mailer';
import { encryptSecret, SECRET_KEY_ENV } from './secret-encryption';

const KEY = 'k'.repeat(48);

const settings = (over: Record<string, unknown> = {}) => ({
  smtpEnabled: true,
  smtpHost: 'smtp.example.edu',
  smtpPort: 587,
  smtpSecurity: 'STARTTLS',
  smtpUsername: 'afct',
  smtpPassword: null,
  smtpFromAddress: 'afct@example.edu',
  smtpFromName: 'AFCT',
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env[SECRET_KEY_ENV] = KEY;
  sendMailMock.mockResolvedValue({ messageId: 'x' });
  prismaMock.systemSettings.findUnique.mockResolvedValue(settings());
});

describe('reading the configuration', () => {
  // An install that wants nothing to do with email is a supported configuration, not a broken
  // one, so this is null rather than a thrown error.
  it('reports mail as unavailable when it is switched off', async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue(settings({ smtpEnabled: false }));

    expect(await getSmtpConfig()).toBeNull();
  });

  it('reports mail as unavailable when there are no settings at all', async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue(null);

    expect(await getSmtpConfig()).toBeNull();
  });

  // Switched on but unusable is a real misconfiguration and an admin needs to see it.
  it('complains when mail is on but incomplete', async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue(settings({ smtpHost: null }));

    await expect(getSmtpConfig()).rejects.toThrow(/not fully configured/);
  });

  it('decrypts the stored password', async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue(
      settings({ smtpPassword: encryptSecret('hunter2') }),
    );

    expect((await getSmtpConfig())?.password).toBe('hunter2');
  });

  /**
   * A missing encryption key and a wrong mail password need different fixes, so they must not
   * produce the same message. Reporting this as a login failure would send an admin to change
   * a password that was never the problem.
   */
  it('says the key is the problem, not the password, when it cannot decrypt', async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue(
      settings({ smtpPassword: encryptSecret('hunter2') }),
    );
    delete process.env[SECRET_KEY_ENV];

    await expect(getSmtpConfig()).rejects.toThrow(/could not be read/);
  });
});

describe('sending', () => {
  it('refuses to send when mail is switched off', async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue(settings({ smtpEnabled: false }));

    await expect(sendMail({ to: 'a@b.edu', subject: 's', text: 't' })).rejects.toThrow(MailError);
  });

  it('sends from the configured address and name', async () => {
    await sendMail({ to: 'student@example.edu', subject: 'Hello', text: 'Body' });

    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: { name: 'AFCT', address: 'afct@example.edu' },
        to: 'student@example.edu',
        subject: 'Hello',
        text: 'Body',
      }),
    );
  });

  it('sends from a bare address when no display name is set', async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue(settings({ smtpFromName: null }));

    await sendMail({ to: 'a@b.edu', subject: 's', text: 't' });

    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'afct@example.edu' }),
    );
  });

  /**
   * STARTTLS must be mandatory, not best-effort. Without `requireTLS`, a server that does not
   * offer the upgrade gets the credentials over a plain connection instead of failing.
   */
  it('demands the STARTTLS upgrade rather than accepting a plain connection', async () => {
    await sendMail({ to: 'a@b.edu', subject: 's', text: 't' });

    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({ secure: false, requireTLS: true }),
    );
  });

  it('uses implicit TLS when that is what the server speaks', async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue(
      settings({ smtpSecurity: 'TLS', smtpPort: 465 }),
    );

    await sendMail({ to: 'a@b.edu', subject: 's', text: 't' });

    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({ secure: true, requireTLS: false }),
    );
  });

  it('sends without credentials when the server needs none', async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue(settings({ smtpUsername: null }));

    await sendMail({ to: 'a@b.edu', subject: 's', text: 't' });

    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({ auth: undefined }),
    );
  });
});

/**
 * The project's rule is that an error says what to do next, and the people reading these are
 * professors rather than sysadmins. A raw "EAUTH" helps nobody.
 */
describe('explaining a failure', () => {
  const failWith = (code: string) => {
    sendMailMock.mockRejectedValue(Object.assign(new Error('raw'), { code }));
    return sendMail({ to: 'a@b.edu', subject: 's', text: 't' });
  };

  it('points at the username and password on an auth failure', async () => {
    await expect(failWith('EAUTH')).rejects.toThrow(/username or password/);
  });

  it('points at the address and port when the connection is refused', async () => {
    await expect(failWith('ECONNREFUSED')).rejects.toThrow(/server address and port/);
  });

  it('points at a typo when the host does not resolve', async () => {
    await expect(failWith('ENOTFOUND')).rejects.toThrow(/typo/);
  });

  it('explains that institutions restrict the from address', async () => {
    await expect(failWith('EENVELOPE')).rejects.toThrow(/from address/);
  });

  it('still says something useful for an unrecognised failure', async () => {
    sendMailMock.mockRejectedValue(new Error('something odd'));

    await expect(sendMail({ to: 'a@b.edu', subject: 's', text: 't' })).rejects.toThrow(
      /something odd/,
    );
  });
});

describe('isMailConfigured', () => {
  it('is false when mail is switched off', async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue(settings({ smtpEnabled: false }));

    expect(await isMailConfigured()).toBe(false);
  });

  // Showing the feature and its error beats a page that pretends the feature does not exist.
  it('is true when mail is on but broken, so the error is reachable', async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue(settings({ smtpHost: null }));

    expect(await isMailConfigured()).toBe(true);
  });
});

describe('the test message', () => {
  it('says plainly what a successful delivery proves', async () => {
    await sendTestEmail('admin@example.edu');

    const sent = sendMailMock.mock.calls[0][0];
    expect(sent.to).toBe('admin@example.edu');
    expect(sent.text).toMatch(/password reset links/);
  });
});

/**
 * Credentials over an unencrypted connection.
 *
 * SMTP AUTH on a plain connection puts the username and password on the wire in clear text, and
 * at most institutions the mail account is a directory account rather than a mail-only one, so
 * what leaks is not just email. `NONE` itself stays supported: a local relay that wants no
 * sign-in is a normal thing to have, and quietly upgrading the transport an administrator chose
 * would be its own kind of wrong.
 */
describe('what may be sent over an unencrypted connection', () => {
  it('allows a plain connection with no credentials', async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue(
      settings({ smtpSecurity: 'NONE', smtpUsername: null, smtpPassword: null, smtpPort: 25 }),
    );

    await expect(getSmtpConfig()).resolves.toMatchObject({ security: 'NONE', username: null });
  });

  it('refuses a plain connection carrying a username', async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue(
      settings({ smtpSecurity: 'NONE', smtpUsername: 'afct', smtpPassword: null }),
    );

    await expect(getSmtpConfig()).rejects.toThrow(/requires STARTTLS or TLS/);
  });

  // A stored password with no username is still a credential somebody meant to use.
  it('refuses a plain connection carrying a password', async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue(
      settings({ smtpSecurity: 'NONE', smtpUsername: null, smtpPassword: encryptSecret('s3cret') }),
    );

    await expect(getSmtpConfig()).rejects.toThrow(/requires STARTTLS or TLS/);
  });

  it('allows credentials over STARTTLS', async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue(
      settings({ smtpSecurity: 'STARTTLS', smtpUsername: 'afct', smtpPassword: encryptSecret('s') }),
    );

    await expect(getSmtpConfig()).resolves.toMatchObject({ security: 'STARTTLS', password: 's' });
  });

  it('allows credentials over TLS', async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue(
      settings({
        smtpSecurity: 'TLS',
        smtpPort: 465,
        smtpUsername: 'afct',
        smtpPassword: encryptSecret('s'),
      }),
    );

    await expect(getSmtpConfig()).resolves.toMatchObject({ security: 'TLS', password: 's' });
  });
});

/**
 * A password is an opaque secret and goes to the server exactly as it was stored, spaces and all.
 * It used to be trimmed on the way in, which produced a login failure with nothing on any screen
 * to explain it.
 */
describe('the password that reaches the server', () => {
  it('keeps leading and trailing spaces', async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue(
      settings({ smtpPassword: encryptSecret('  spaced secret  ') }),
    );

    await expect(getSmtpConfig()).resolves.toMatchObject({ password: '  spaced secret  ' });
  });

  it('keeps a password made entirely of spaces', async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue(
      settings({ smtpPassword: encryptSecret('   ') }),
    );

    await expect(getSmtpConfig()).resolves.toMatchObject({ password: '   ' });
  });
});

/**
 * What ends up in an activity log or on an admin's screen after a failed send.
 *
 * The transport's own message is worth quoting, since it is often the only thing that says what
 * a particular server objected to. It is also written by a library holding the credentials, so
 * they are struck out of it rather than trusted not to appear.
 */
describe('what a failure is allowed to say', () => {
  it('does not repeat the password back', async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue(
      settings({ smtpUsername: 'afct-mailer', smtpPassword: encryptSecret('hunter2secret') }),
    );
    sendMailMock.mockRejectedValue(new Error('login failed for afct-mailer/hunter2secret'));

    await expect(sendMail({ to: 'a@b.test', subject: 's', text: 't' })).rejects.toThrow(
      /\[removed\]/,
    );
    const thrown = await sendMail({ to: 'a@b.test', subject: 's', text: 't' }).catch(
      (error: Error) => error.message,
    );
    expect(thrown).not.toContain('hunter2secret');
    expect(thrown).not.toContain('afct-mailer');
  });
});

/**
 * Whether waiting helps. A rejected password will be rejected again in five minutes and needs
 * somebody to change a setting; a connection that timed out is worth another go.
 */
describe('deciding whether to try again', () => {
  const withCode = (code: string) => Object.assign(new Error('nope'), { code });

  it('gives up on a rejected password', () => {
    expect(isRetryableMailFailure(withCode('EAUTH'))).toBe(false);
  });

  it('gives up on a refused sender or recipient', () => {
    expect(isRetryableMailFailure(withCode('EENVELOPE'))).toBe(false);
  });

  it('waits on a connection that could not be made', () => {
    expect(isRetryableMailFailure(withCode('ECONNREFUSED'))).toBe(true);
  });

  // SMTP says the same thing in its reply codes: 4xx is temporary, 5xx is not.
  it('waits on a temporary reply code', () => {
    expect(isRetryableMailFailure(Object.assign(new Error('busy'), { responseCode: 451 }))).toBe(
      true,
    );
  });

  it('gives up on a permanent reply code', () => {
    expect(isRetryableMailFailure(Object.assign(new Error('no'), { responseCode: 550 }))).toBe(
      false,
    );
  });

  // Mail switched off, or a configuration that cannot be used. Retrying changes neither.
  it('gives up when mail is not usable at all', () => {
    expect(isRetryableMailFailure(new MailError('Email is not switched on'))).toBe(false);
  });
});

/**
 * Retryability has to survive being wrapped.
 *
 * `sendMail` turns the transport's error into a `MailError` so the message is safe to show and
 * to store, and in doing so it discards the `code` and `responseCode` that say whether waiting
 * would help. Classifying after the wrap therefore saw nothing and called everything permanent,
 * which made the queue's whole backoff schedule decorative: the first timeout gave up.
 *
 * These go through `sendMail`, deliberately. Asserting on the classifier alone is what missed it.
 */
describe('what the queue is told after a real send fails', () => {
  const failWith = async (transportError: unknown) => {
    sendMailMock.mockRejectedValue(transportError);
    return sendMail({ to: 'a@b.test', subject: 's', text: 't' }).catch((error: unknown) => error);
  };

  const withCode = (code: string) => Object.assign(new Error('nope'), { code });
  const withReply = (responseCode: number) => Object.assign(new Error('reply'), { responseCode });

  it('retries a timeout', async () => {
    expect(isRetryableMailFailure(await failWith(withCode('ETIMEDOUT')))).toBe(true);
  });

  it('retries a refused connection', async () => {
    expect(isRetryableMailFailure(await failWith(withCode('ECONNREFUSED')))).toBe(true);
  });

  it('retries a name that would not resolve', async () => {
    expect(isRetryableMailFailure(await failWith(withCode('ENOTFOUND')))).toBe(true);
  });

  // SMTP 4xx is "not now"; the schedule exists for exactly this.
  it('retries a temporary SMTP reply', async () => {
    expect(isRetryableMailFailure(await failWith(withReply(451)))).toBe(true);
  });

  it('does not retry a rejected password', async () => {
    expect(isRetryableMailFailure(await failWith(withCode('EAUTH')))).toBe(false);
  });

  it('does not retry a rejected sender or recipient', async () => {
    expect(isRetryableMailFailure(await failWith(withCode('EENVELOPE')))).toBe(false);
  });

  it('does not retry a permanent SMTP reply', async () => {
    expect(isRetryableMailFailure(await failWith(withReply(550)))).toBe(false);
  });

  // Mail switched off is a configuration problem, and no amount of waiting fixes it.
  it('does not retry mail being switched off', async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue(settings({ smtpEnabled: false }));

    const error = await sendMail({ to: 'a@b.test', subject: 's', text: 't' }).catch(
      (e: unknown) => e,
    );

    expect(isRetryableMailFailure(error)).toBe(false);
  });
});

/**
 * Whether a reset can actually be delivered, which is a different question from whether the
 * Email tab should show its settings.
 *
 * `isMailConfigured` answers a broken configuration with "available" on purpose, so an
 * administrator sees the feature and its error. Asked whether a reset link can be sent, that
 * answer queues a message that can never go out and leaves somebody waiting for it.
 */
describe('whether a password reset can be delivered', () => {
  beforeEach(() => {
    process.env.NEXTAUTH_URL = 'https://afct.example.edu';
  });

  it('says yes when mail and the address are both usable', async () => {
    await expect(canSendPasswordReset()).resolves.toEqual({ ok: true });
  });

  it('says no when mail is switched off', async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue(settings({ smtpEnabled: false }));

    await expect(canSendPasswordReset()).resolves.toMatchObject({ ok: false });
  });

  /**
   * The case that made this worth separating. A stored password that will not decrypt throws,
   * and `isMailConfigured` reports that as available.
   */
  it('says no when the stored password cannot be read', async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue(
      settings({ smtpPassword: encryptSecret('s') }),
    );
    process.env[SECRET_KEY_ENV] = 'a-completely-different-key-of-the-right-length';

    const result = await canSendPasswordReset();

    expect(result.ok).toBe(false);
    // Still the admin-facing wording rather than a decryption error.
    expect(result.ok === false && result.reason).toMatch(/mail password|mail settings/i);
  });

  it('says no when the configuration is half filled in', async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue(settings({ smtpHost: null }));

    await expect(canSendPasswordReset()).resolves.toMatchObject({ ok: false });
  });

  // The other half: a working mail server is no use without an address for the link.
  it('says no when the site does not know its own address', async () => {
    delete process.env.NEXTAUTH_URL;

    await expect(canSendPasswordReset()).resolves.toMatchObject({ ok: false });
  });
});
