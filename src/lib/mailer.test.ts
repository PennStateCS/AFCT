import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  systemSettings: { findUnique: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

const sendMailMock = vi.hoisted(() => vi.fn());
const createTransportMock = vi.hoisted(() => vi.fn(() => ({ sendMail: sendMailMock })));
vi.mock('nodemailer', () => ({ default: { createTransport: createTransportMock } }));

import { getSmtpConfig, isMailConfigured, MailError, sendMail, sendTestEmail } from './mailer';
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
