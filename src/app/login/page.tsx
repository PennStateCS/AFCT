import { prisma } from '@/lib/prisma';
import { DEFAULT_ALLOW_SIGNUP } from '@/lib/system-settings';
import { getHcaptchaSiteKey } from '@/lib/hcaptcha';
import { isMailConfigured } from '@/lib/mailer';
import LoginForm from './LoginForm';

/**
 * The login screen's server shell.
 *
 * The two settings the form needs before it can render correctly, whether signup is open and
 * the hCaptcha *site* key, used to be fetched from /api/system-settings/public in an effect
 * after hydration. That meant a round trip on the one page every user hits before they have a
 * session, and the "Sign up" link appearing a beat after the rest of the form. Reading them
 * here makes the first paint correct.
 *
 * Only the public subset is read: the hCaptcha SECRET is never touched on this path.
 */
export default async function LoginPage() {
  let allowSignup = DEFAULT_ALLOW_SIGNUP;
  let hcaptchaSiteKey: string | undefined;
  // Offering "forgot your password" on a site that cannot send mail leads to a page that can
  // only apologise, so the link appears only where it works.
  let mailConfigured = false;

  // A database blip must not take the login page down: fall back to the defaults and let
  // people sign in, which is the same posture the public settings route takes.
  try {
    const [settings, siteKey, mailReady] = await Promise.all([
      prisma.systemSettings.findUnique({
        where: { id: 1 },
        select: { allowSignup: true },
      }),
      getHcaptchaSiteKey(),
      isMailConfigured(),
    ]);
    allowSignup = settings?.allowSignup ?? DEFAULT_ALLOW_SIGNUP;
    hcaptchaSiteKey = siteKey ?? undefined;
    mailConfigured = mailReady;
  } catch (error) {
    console.error('login page settings read failed:', error);
  }

  return (
    <LoginForm
      allowSignup={allowSignup}
      hcaptchaSiteKey={hcaptchaSiteKey}
      mailConfigured={mailConfigured}
    />
  );
}
