import { z } from 'zod';

/**
 * What an administrator pastes in when registering an LMS.
 *
 * Every value here comes from the LMS's own developer-key screen. The URLs are validated because
 * a typo in one of them fails at a different stage of a launch each time, and the resulting error
 * rarely points back at the field that caused it.
 */

const httpsUrl = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .refine((value) => {
      try {
        return new URL(value).protocol === 'https:';
      } catch {
        return false;
      }
    }, `${label} must be a full https:// address, for example https://canvas.your-university.edu/login/oauth2/auth`);

export const LtiPlatformSchema = z.object({
  name: z.string().trim().min(1, 'Give this LMS a name so you can recognise it later.').max(100),
  /**
   * Not required to be a URL: the spec says an issuer is an identifier, and while it is a URL in
   * practice for every LMS anyone runs, refusing a valid non-URL issuer would be wrong.
   */
  issuer: z.string().trim().min(1, 'The platform issuer is required.'),
  clientId: z.string().trim().min(1, 'The client ID is required.'),
  deploymentId: z.string().trim().min(1, 'The deployment ID is required.'),
  authLoginUrl: httpsUrl('The authorization URL'),
  tokenUrl: httpsUrl('The token URL'),
  keysetUrl: httpsUrl('The public keyset URL'),
});

export type LtiPlatformInput = z.infer<typeof LtiPlatformSchema>;
