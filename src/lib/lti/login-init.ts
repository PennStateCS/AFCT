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

import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { startLaunch, LAUNCH_TTL_MS } from '@/lib/lti/launch-transaction';

/** The prefix of the cookie holding the state value, matched when the launch comes back. */
export const LTI_STATE_COOKIE = 'afct.lti.state';

/**
 * One cookie per launch, named from the state it holds.
 *
 * A single fixed name meant opening two LMS links at once made the second overwrite the first,
 * and whichever came back second was refused. The name is derived from the state, which comes
 * back in the form post, so the right cookie can still be found without guessing.
 */
export function stateCookieName(state: string): string {
  const suffix = crypto.createHash('sha256').update(state).digest('hex').slice(0, 16);
  return `${LTI_STATE_COOKIE}.${suffix}`;
}

/** Short: this covers one redirect to the LMS and back, not a sign-in session. */
export const LAUNCH_STATE_TTL_MS = LAUNCH_TTL_MS;

/** What the platform sends to start a launch. All of it is unverified. */
export type LoginInitParams = {
  iss?: string | null;
  login_hint?: string | null;
  target_link_uri?: string | null;
  lti_message_hint?: string | null;
  client_id?: string | null;
  /**
   * The frame the platform will accept browser-storage messages on.
   *
   * Its presence is the platform saying it can hold a value for AFCT in the browser, which is
   * the only way to check a returning launch when the browser refuses the state cookie.
   */
  lti_storage_target?: string | null;
  lti_deployment_id?: string | null;
};

export type LoginInitRefusal =
  /** The request did not say which LMS it came from. */
  | 'missing-issuer'
  /**
   * The request did not say who is launching.
   *
   * `login_hint` is required of a third-party initiated login, and it is what the platform
   * needs back to know whose session this is. Forwarding an empty one produced a launch that
   * failed later, at the platform, with a message nobody could trace back to here.
   */
  | 'missing-login-hint'
  /**
   * The request did not say what is being launched. `target_link_uri` is required, and it is
   * what the launch is checked against when it returns, so an absent one cannot be verified.
   */
  | 'missing-target-link-uri'
  /** No registration matches what it did say. */
  | 'unregistered-platform'
  /**
   * The issuer matches several registrations and the request did not say which. Only possible
   * when a platform omits `client_id`, which the spec allows and which is ambiguous when one
   * LMS has AFCT installed more than once.
   */
  | 'ambiguous-platform';

export type LoginInitResult =
  | { ok: true; redirectUrl: string; state: string; storageTarget: string | null }
  | { ok: false; reason: LoginInitRefusal };

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

  /**
   * Both are required parameters of the initiation request, and an empty string is not a value.
   * Refusing here says what is wrong while somebody can still act on it; the alternative was
   * sending `login_hint=` to the platform and letting the launch fail somewhere else.
   */
  if (!params.login_hint?.trim()) return { ok: false, reason: 'missing-login-hint' };
  if (!params.target_link_uri?.trim()) {
    return { ok: false, reason: 'missing-target-link-uri' };
  }

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

  // One record holds both secrets, the registration and the target link URI, so the token that
  // comes back can be checked against the login that asked for it.
  const { state, nonce } = await startLaunch({
    platformId: platform.id,
    targetLinkUri: params.target_link_uri,
    storageTarget: params.lti_storage_target,
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
  query.set('login_hint', params.login_hint);
  query.set('state', state);
  query.set('nonce', nonce);
  // The platform has already authenticated this person; AFCT must not cause a second prompt.
  query.set('prompt', 'none');
  if (params.lti_message_hint) query.set('lti_message_hint', params.lti_message_hint);

  return {
    ok: true,
    redirectUrl: url.toString(),
    state,
    storageTarget: params.lti_storage_target?.trim() || null,
  };
}

/** What to tell somebody whose launch could not even be started. */
export function loginInitRefusalMessage(reason: LoginInitRefusal): string {
  switch (reason) {
    case 'unregistered-platform':
      return 'This LMS is not registered with AFCT. An administrator needs to add it in Admin, System Settings, LTI.';
    case 'ambiguous-platform':
      return 'AFCT is registered more than once for this LMS and the launch did not say which registration to use. An administrator needs to remove the duplicate registration.';
    case 'missing-login-hint':
      return 'This launch did not say who is opening AFCT. Your LMS has to send a login hint, which is part of every LTI launch, so this is a fault in the LMS or in how AFCT is registered there.';
    case 'missing-target-link-uri':
      return 'This launch did not say what it was opening. Your LMS has to send a target link address, which is part of every LTI launch.';
    case 'missing-issuer':
    default:
      return 'This launch did not come from a recognisable LMS.';
  }
}
