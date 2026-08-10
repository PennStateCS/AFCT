import { z } from 'zod';

/**
 * Mail server settings.
 *
 * The same schema backs the form and the route, so the browser and the server cannot disagree
 * about what is valid. Validation here is deliberately strict about the two fields people get
 * wrong: a port outside the legal range, and a from address that is not an address at all.
 * "It silently never sent" is the failure nobody can diagnose.
 */

export const SMTP_SECURITY = ['NONE', 'STARTTLS', 'TLS'] as const;
export type SmtpSecurity = (typeof SMTP_SECURITY)[number];

/** What each option means, for the form. Kept beside the values so the two stay in step. */
export const SMTP_SECURITY_LABELS: Record<SmtpSecurity, string> = {
  STARTTLS: 'STARTTLS (usually port 587)',
  TLS: 'TLS (usually port 465)',
  NONE: 'None (unencrypted)',
};

const trimmedOptional = z
  .string()
  .trim()
  .max(255)
  .optional()
  .transform((v) => (v === '' ? undefined : v));

export const SmtpSettingsSchema = z.object({
  smtpEnabled: z.boolean().optional(),
  smtpHost: trimmedOptional,
  smtpPort: z.coerce.number().int().min(1).max(65535).optional(),
  smtpSecurity: z.enum(SMTP_SECURITY).optional(),
  smtpUsername: trimmedOptional,
  /**
   * Write-only, following the hCaptcha secret already in this settings route: an empty value
   * means "keep what is stored", and clearing is an explicit flag. Otherwise saving the form
   * without retyping the password would wipe it.
   */
  smtpPassword: z.string().optional(),
  smtpPasswordClear: z.boolean().optional(),
  /**
   * Deliberately more permissive than a strict email check: `afct@localhost` is a real,
   * usable address, and it is what a local mail catcher wants. Requiring a dotted domain
   * rejected legitimate setups while catching almost nothing worth catching, since a typo in
   * a real domain passes either way. The mail server has the final say, and a sender it
   * refuses comes back as a message that names the problem.
   */
  smtpFromAddress: z
    .string()
    .trim()
    .max(255)
    .refine((v) => v === '' || /^[^\s@]+@[^\s@]+$/.test(v), {
      message: 'Enter an address like afct@your-university.edu.',
    })
    .optional(),
  smtpFromName: trimmedOptional,
});

export type SmtpSettingsInput = z.infer<typeof SmtpSettingsSchema>;

/** The address a test message is sent to. Its own schema because it is its own endpoint. */
export const SendTestEmailSchema = z.object({
  to: z.string().trim().email().max(255),
});
