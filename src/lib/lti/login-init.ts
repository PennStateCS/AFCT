/**
 * Starting an LTI launch: the third-party initiated login.
 *
 * A launch is a three-legged redirect and this is the first leg. The LMS sends the browser here
 * saying only "somebody wants to open you"; AFCT answers by sending the browser on to the LMS's
 * own authorization endpoint, which is what eventually posts a signed token back. Nothing here
 * is trusted or authenticated: the whole request is attacker-controllable, and its only job is
 * to pick a registration and mint two secrets.
 *
 * Those two secrets do different jobs and both are needed:
 *
 *  - **nonce** goes in the token and is consumed when the launch is validated. It stops the same
 *    launch being used twice.
 *  - **state** comes back alongside the token and is matched against a cookie set here. It ties
 *    the launch to *this browser*. Without it, somebody could start a launch as themselves and
 *    get a victim's browser to complete it, signing the victim in as the attacker. The nonce
 *    cannot catch that, because such a launch is fresh rather than replayed.
 */

import { prisma } from '@/lib/prisma';
import { issueSingleUseToken } from '@/lib/single-use-token';
import { issueLaunchNonce } from '@/lib/lti/launch';

/** The cookie holding the state value, matched when the launch comes back. */
export const LTI_STATE_COOKIE = 'afct.lti.state';

/** Short: this covers one redirect to the LMS and back, not a sign-in session. */
export const LAUNCH_STATE_TTL_MS = 10 * 60 * 1000;

/** What the platform sends to start a launch. All of it is unverified. */
export type LoginInitParams = {
  iss?: string | null;
  login_hint?: string | null;
  target_link_uri?: string | null;
  lti_message_hint?: string | null;
  client_id?: string | null;
  lti_deployment_id?: string | null;
};

export type LoginInitRefusal =
  /** The request did not say which LMS it came from. */
  | 'missing-issuer'
  /** No registration matches what it did say. */
  | 'unregistered-platform'
  /**
   * The issuer matches several registrations and the request did not say which. Only possible
   * when a platform omits `client_id`, which the spec allows and which is ambiguous when one
   * LMS has AFCT installed more than once.
   */
  | 'ambiguous-platform';

export type LoginInitResult =
  { ok: true; redirectUrl: string; state: string } | { ok: false; reason: LoginInitRefusal };

/**
 * Work out where to send the browser next, and mint the state and nonce for the launch.
 *
 * `redirectUri` is AFCT's own launch endpoint, and must be exactly what is registered in the
 * LMS: platforms compare it as a string and refuse a mismatch, which is a common and
 * confusingly-reported setup error.
 */
export async function beginLaunch(opts: {
  params: LoginInitParams;
  redirectUri: string;
}): Promise<LoginInitResult> {
  const { params, redirectUri } = opts;

  const issuer = params.iss?.trim();
  if (!issuer) return { ok: false, reason: 'missing-issuer' };

  // `client_id` and `lti_deployment_id` are optional in a login request, so this narrows by
  // whatever was sent rather than requiring the full triple.
  const candidates = await prisma.ltiPlatform.findMany({
    where: {
      issuer,
      ...(params.client_id ? { clientId: params.client_id } : {}),
      ...(params.lti_deployment_id ? { deploymentId: params.lti_deployment_id } : {}),
    },
  });

  if (candidates.length === 0) return { ok: false, reason: 'unregistered-platform' };
  // Refused rather than guessed. Picking one would send the person into a launch that then fails
  // verification against a different registration, which is far harder to diagnose than this.
  if (candidates.length > 1) return { ok: false, reason: 'ambiguous-platform' };

  const platform = candidates[0];
  // Unreachable given the two checks above; this is the type system asking for proof, not a
  // case that happens.
  if (!platform) return { ok: false, reason: 'unregistered-platform' };

  const nonce = await issueLaunchNonce();
  const { token: state } = await issueSingleUseToken({
    purpose: 'LTI_LAUNCH_STATE',
    ttlMs: LAUNCH_STATE_TTL_MS,
  });

  const url = new URL(platform.authLoginUrl);
  const query = url.searchParams;
  query.set('scope', 'openid');
  query.set('response_type', 'id_token');
  // The token comes back as a form POST rather than in the URL: it is long, and a query string
  // ends up in browser history and server logs.
  query.set('response_mode', 'form_post');
  query.set('client_id', platform.clientId);
  query.set('redirect_uri', redirectUri);
  query.set('login_hint', params.login_hint ?? '');
  query.set('state', state);
  query.set('nonce', nonce);
  // The platform has already authenticated this person; AFCT must not cause a second prompt.
  query.set('prompt', 'none');
  if (params.lti_message_hint) query.set('lti_message_hint', params.lti_message_hint);

  return { ok: true, redirectUrl: url.toString(), state };
}

/** What to tell somebody whose launch could not even be started. */
export function loginInitRefusalMessage(reason: LoginInitRefusal): string {
  switch (reason) {
    case 'unregistered-platform':
      return 'This LMS is not registered with AFCT. An administrator needs to add it in Admin, System Settings, LTI.';
    case 'ambiguous-platform':
      return 'AFCT is registered more than once for this LMS and the launch did not say which registration to use. An administrator needs to remove the duplicate registration.';
    case 'missing-issuer':
    default:
      return 'This launch did not come from a recognisable LMS.';
  }
}
