/**
 * Sending mail.
 *
 * One message type today (the password-reset link), behind an interface that does not assume
 * one, so adding notifications later does not mean rewriting this. Nothing calls `sendMail`
 * from a request any more except the admin's own test message: everything else goes through
 * `mail-queue`, so a slow mail server cannot hold a page open or time a request differently
 * depending on whose account it is about.
 *
 * Mail is **off unless an admin turns it on**. An install that wants nothing to do with email
 * behaves exactly as it did before this existed.
 */

import nodemailer from 'nodemailer';
import { prisma } from '@/lib/prisma';
import { readStoredSecret, SecretKeyError } from '@/lib/secret-encryption';
import { getPublicAppUrl } from '@/lib/public-app-url';

export type MailMessage = {
  to: string;
  subject: string;
  /** Plain text is required; HTML is optional and always accompanies a text alternative. */
  text: string;
  html?: string;
};

/**
 * Why a send failed, in terms an admin can act on.
 *
 * Carries `retryable` because the answer is only knowable here. Wrapping the transport's error
 * is what makes the message safe to show and to store, and it also throws away the `code` and
 * `responseCode` that say whether waiting would help. Deciding at the point of the throw, while
 * the original is still in hand, is the only place that has both.
 */
export class MailError extends Error {
  constructor(
    message: string,
    /** False for a configuration problem somebody has to fix; true for a bad moment. */
    readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = 'MailError';
  }
}

/**
 * What an administrator is told when they try to authenticate over a plain connection.
 *
 * One string, exported, so the settings route and the mailer say the same thing rather than two
 * near-identical sentences that drift.
 */
export const SMTP_AUTH_NEEDS_TLS =
  'SMTP authentication requires STARTTLS or TLS. A username and password sent over an unencrypted connection can be read in transit, so either choose an encrypted connection or leave the username and password blank.';

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

  /**
   * Credentials require an encrypted connection.
   *
   * SMTP AUTH over a plain connection puts the username and password on the wire in the clear,
   * and for most institutions that is a directory account rather than a mail-only one. The
   * settings route refuses to save such a combination; this is the check that matters if one
   * arrives another way, such as a database edited by hand or a restored backup from before the
   * rule existed.
   *
   * `NONE` itself stays supported. An unauthenticated local relay is a normal thing to have, and
   * quietly upgrading the administrator's chosen transport would be its own kind of wrong.
   */
  if (s.smtpSecurity === 'NONE' && (s.smtpUsername || s.smtpPassword)) {
    throw new MailError(SMTP_AUTH_NEEDS_TLS);
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

/**
 * Whether AFCT can actually deliver a password reset.
 *
 * Two things have to be true, and the second used to be assumed. A working mail server is no use
 * without an address to put in the link: with `NEXTAUTH_URL` unset the email went out carrying
 * `/reset-password?token=...`, which is not a link once it is in a mail client. Offering a
 * recovery that cannot work is worse than saying plainly that it is unavailable, because the
 * person waits for an email instead of asking somebody for help.
 */
export async function canSendPasswordReset(): Promise<
  { ok: true } | { ok: false; reason: string }
> {
  const url = getPublicAppUrl();
  if (!url.ok) return { ok: false, reason: url.message };

  /**
   * The configuration itself, not `isMailConfigured`.
   *
   * The two answer different questions and only one of them is this one. `isMailConfigured`
   * reports a broken configuration as *available* on purpose, so an administrator sees the
   * feature and its error rather than a page pretending mail does not exist. Asked "can this
   * site actually send a reset", that answer is simply wrong: a stored password that cannot be
   * decrypted, or a half-filled configuration, would queue a message that can never go out and
   * leave somebody waiting for it.
   */
  try {
    if (!(await getSmtpConfig())) {
      return {
        ok: false,
        reason:
          'Email is not switched on for this site. An administrator can configure it on the Email tab in System Settings.',
      };
    }
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof MailError ? error.message : 'The mail settings could not be read.',
    };
  }

  return { ok: true };
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
/**
 * Remove anything secret from a message before it is shown or stored.
 *
 * The default branch below quotes the transport's own text, which is worth having: it is often
 * the only thing that says what a particular server objected to. It is also written by a library
 * that has the credentials in hand, so it is not AFCT's to promise it never echoes them. Rather
 * than reason about which nodemailer errors might, the two values are simply struck out of
 * whatever comes back.
 */
function redactCredentials(message: string, config: SmtpConfig): string {
  let safe = message;
  for (const secret of [config.password, config.username]) {
    // A one-character username would match everywhere and redact the whole message; anything
    // that short is not worth hiding anyway.
    if (secret && secret.length >= 3) safe = safe.split(secret).join('[removed]');
  }
  return safe;
}

function explain(error: unknown, config: SmtpConfig): string {
  const code = (error as { code?: string })?.code ?? '';
  const message = redactCredentials(
    error instanceof Error ? error.message : String(error),
    config,
  );

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
      // Nothing about this improves by being tried again.
      false,
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
    throw new MailError(explain(error, config), isRetryableTransportError(error));
  }
}

/**
 * Whether a *transport* error is worth another go.
 *
 * A rejected password or a refused sender address will be rejected again in five minutes and
 * needs somebody to change a setting; a connection that timed out is worth waiting on. SMTP says
 * the same thing in its reply codes, so a 4xx is temporary and a 5xx is not.
 *
 * Reads the raw error, so it has to be called before that error is wrapped. Everything outside
 * this file uses `isRetryableMailFailure`.
 */
function isRetryableTransportError(error: unknown): boolean {
  const code = (error as { code?: string })?.code ?? '';
  const responseCode = (error as { responseCode?: number })?.responseCode;

  switch (code) {
    case 'EAUTH':
    case 'EENVELOPE':
      return false;
    case 'ECONNREFUSED':
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
    case 'ETIMEDOUT':
    case 'ESOCKET':
    case 'ECONNECTION':
      return true;
    default:
      break;
  }

  if (typeof responseCode === 'number') return responseCode < 500;
  // An unrecognised transport failure is more often a bad moment than a permanent refusal, and
  // the attempt limit stops an optimistic guess from retrying for ever.
  return true;
}

/**
 * Whether a failure from `sendMail` is worth another go.
 *
 * Reads the answer off the error rather than trying to recover it afterwards. Doing it the other
 * way round made the backoff decorative: a `MailError` carries none of the transport's fields,
 * so classifying it after the wrap saw no code and no response code, decided every failure was
 * permanent, and gave up on the first attempt. The timeouts and 4xx replies the retry schedule
 * was written for never reached it.
 */
export function isRetryableMailFailure(error: unknown): boolean {
  if (error instanceof MailError) return error.retryable;
  return isRetryableTransportError(error);
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
