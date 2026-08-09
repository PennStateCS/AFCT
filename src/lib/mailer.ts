/**
 * Sending mail.
 *
 * One message type today (the password-reset link), behind an interface that does not assume
 * one, so adding notifications later does not mean rewriting this. No queue yet: a reset is
 * sent in response to a person clicking a button, and a failure is worth telling them about
 * immediately rather than retrying quietly.
 *
 * Mail is **off unless an admin turns it on**. An install that wants nothing to do with email
 * behaves exactly as it did before this existed.
 */

import nodemailer from 'nodemailer';
import { prisma } from '@/lib/prisma';
import { readStoredSecret, SecretKeyError } from '@/lib/secret-encryption';

export type MailMessage = {
  to: string;
  subject: string;
  /** Plain text is required; HTML is optional and always accompanies a text alternative. */
  text: string;
  html?: string;
};

/** Why a send failed, in terms an admin can act on. */
export class MailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MailError';
  }
}

type SmtpConfig = {
  host: string;
  port: number;
  security: 'NONE' | 'STARTTLS' | 'TLS';
  username: string | null;
  password: string | null;
  fromAddress: string;
  fromName: string | null;
};

/**
 * Read and validate the stored configuration.
 *
 * Returns null when mail is switched off, which callers treat as "not available" rather than
 * as an error: a site with no mail server is a supported configuration, not a broken one.
 * Throws only when mail is on but unusable, because that is a real misconfiguration an admin
 * needs to see.
 */
export async function getSmtpConfig(): Promise<SmtpConfig | null> {
  const s = await prisma.systemSettings.findUnique({
    where: { id: 1 },
    select: {
      smtpEnabled: true,
      smtpHost: true,
      smtpPort: true,
      smtpSecurity: true,
      smtpUsername: true,
      smtpPassword: true,
      smtpFromAddress: true,
      smtpFromName: true,
    },
  });

  if (!s?.smtpEnabled) return null;

  if (!s.smtpHost || !s.smtpPort || !s.smtpFromAddress) {
    throw new MailError(
      'Email is switched on but not fully configured. Set the server, port and from address on the Email tab in System Settings.',
    );
  }

  let password: string | null = null;
  try {
    password = readStoredSecret(s.smtpPassword);
  } catch (error) {
    // The key is missing or wrong, which is a different problem from a wrong password and
    // needs a different fix. Say which one it is rather than reporting a login failure.
    if (error instanceof SecretKeyError) {
      throw new MailError(
        `The stored mail password could not be read. ${error.message}`,
      );
    }
    throw error;
  }

  return {
    host: s.smtpHost,
    port: s.smtpPort,
    security: s.smtpSecurity,
    username: s.smtpUsername,
    password,
    fromAddress: s.smtpFromAddress,
    fromName: s.smtpFromName,
  };
}

/** Whether AFCT can send mail at all, for surfaces that offer a reset only when it can. */
export async function isMailConfigured(): Promise<boolean> {
  try {
    return (await getSmtpConfig()) !== null;
  } catch {
    // On is better than silently off here: an admin who has misconfigured mail should see the
    // feature and its error, not a page that pretends the feature does not exist.
    return true;
  }
}

function buildTransport(config: SmtpConfig) {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    // `secure` means implicit TLS from the first byte. STARTTLS upgrades a plain connection,
    // and `requireTLS` makes that upgrade mandatory rather than best-effort, so a server that
    // silently does not offer it fails instead of sending credentials in the clear.
    secure: config.security === 'TLS',
    requireTLS: config.security === 'STARTTLS',
    auth: config.username ? { user: config.username, pass: config.password ?? '' } : undefined,
  });
}

/**
 * Turn a transport error into something an admin can act on.
 *
 * The project's rule is that an error says what to do next rather than what failed internally,
 * and the people reading this are professors, not sysadmins.
 */
function explain(error: unknown): string {
  const code = (error as { code?: string })?.code ?? '';
  const message = error instanceof Error ? error.message : String(error);

  switch (code) {
    case 'EAUTH':
      return 'The mail server rejected the username or password. Check them on the Email tab.';
    case 'ECONNREFUSED':
      return 'The mail server refused the connection. Check the server address and port.';
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return 'The mail server could not be found. Check the server address for a typo.';
    case 'ETIMEDOUT':
    case 'ESOCKET':
      return 'Could not reach the mail server. Check the address and port, and whether this machine is allowed to reach it.';
    case 'EENVELOPE':
      return 'The mail server rejected the sender or recipient address. Institutions often require the from address to be one they host.';
    default:
      return `Could not send the message: ${message}`;
  }
}

/**
 * Send a message. Throws `MailError` when mail is off or the send fails.
 *
 * Deliberately throws rather than returning false: a caller that forgets to check a boolean
 * sends nothing and says nothing, which is the failure mode this whole feature exists to end.
 */
export async function sendMail(message: MailMessage): Promise<void> {
  const config = await getSmtpConfig();
  if (!config) {
    throw new MailError(
      'Email is not switched on for this site. An administrator can configure it on the Email tab in System Settings.',
    );
  }

  try {
    await buildTransport(config).sendMail({
      from: config.fromName
        ? { name: config.fromName, address: config.fromAddress }
        : config.fromAddress,
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
    });
  } catch (error) {
    throw new MailError(explain(error));
  }
}

/**
 * Send a test message, so mail is proved working when an admin configures it rather than the
 * first time a student cannot get back into their account.
 */
export async function sendTestEmail(to: string): Promise<void> {
  await sendMail({
    to,
    subject: 'AFCT test message',
    text:
      'This is a test message from AFCT.\n\n' +
      'If you are reading it, the mail settings on this site are working and AFCT can send password reset links.',
  });
}
