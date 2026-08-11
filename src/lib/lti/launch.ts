/**
 * Validating an LTI launch.
 *
 * This is the security boundary of the whole integration. Everything downstream, who the person
 * is, which course they land in, what role they get, is taken from a token that arrives in a
 * browser redirect and is therefore entirely under the sender's control until it is verified.
 * Nothing in here may trust a claim it has not checked.
 *
 * The order has one subtlety worth stating, because it looks wrong at a glance. The token has to
 * be read *before* it is verified, in order to learn which platform sent it and therefore which
 * keyset to verify against. That is safe, and it is what every LTI implementation does, but only
 * because the unverified read is used for nothing except selecting a key. Every claim that
 * matters is checked again after the signature is proved, against the registration, never
 * against the token's own assertions about itself.
 *
 * The negative cases are the point of this file, so they are named rather than collapsed into a
 * boolean: an administrator debugging a failed launch needs to know whether the LMS is
 * unregistered, the clock is out, or a launch is being replayed, and those call for three
 * different actions.
 */

import { decodeJwt, jwtVerify, createRemoteJWKSet, errors as joseErrors } from 'jose';
import type { JWTPayload } from 'jose';
import { prisma } from '@/lib/prisma';
import { consumeSingleUseToken, issueSingleUseToken } from '@/lib/single-use-token';

/** LTI puts its claims under this prefix. Spelled out once rather than inline everywhere. */
const CLAIM = 'https://purl.imsglobal.org/spec/lti/claim';

/** How long a login request may sit before its nonce is refused. Generous for a slow sign-in. */
export const LAUNCH_NONCE_TTL_MS = 10 * 60 * 1000;

/**
 * Clock skew allowed on `exp` and `iat`.
 *
 * Some tolerance is necessary: the LMS and AFCT are different machines and a launch that fails
 * because of a few seconds' drift is impossible for faculty to diagnose. Kept small, because
 * this is also the window in which an expired token still works.
 */
const CLOCK_TOLERANCE_S = 30;

export type LaunchRefusal =
  /** The token is not a JWT at all, or is structurally broken. */
  | 'malformed'
  /** No registration matches the issuer, client id and deployment id in the token. */
  | 'unregistered-platform'
  /** The signature did not verify against the platform's published keys. */
  | 'bad-signature'
  /** Expired, or issued in the future, beyond the allowed clock skew. */
  | 'expired'
  /** The nonce is unknown, already spent, or timed out. A replayed launch lands here. */
  | 'replayed'
  /** Not an LTI 1.3 resource link launch. */
  | 'wrong-message-type'
  /** The deployment id in the token disagrees with the registration matched. */
  | 'deployment-mismatch'
  /** The platform sent no email, so AFCT cannot identify or create a person. */
  | 'no-email';

/**
 * What a deep-linking launch is asking for.
 *
 * The platform is not opening AFCT for a student; it is asking a member of staff to choose
 * something, and telling us where to send the answer.
 */
export type DeepLinkRequest = {
  /** Where the chosen items are posted back. Signed by us, submitted by the browser. */
  returnUrl: string;
  /**
   * Opaque platform state that must come back untouched. Canvas uses it to know which
   * placement asked, and a response without it is rejected.
   */
  data: string | null;
  /** Whether the platform will accept more than one item. */
  multiple: boolean;
};

export type LaunchIdentity = {
  platformId: string;
  /** The platform's stable identifier for this person. Never an email. */
  subject: string;
  issuer: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  /** LTI role URIs, exactly as sent. Mapped to an AFCT role elsewhere, and only on first sight. */
  roles: string[];
  /** The LMS course this launch came from, when it sent one. */
  contextId: string | null;
  contextTitle: string | null;
  /** The specific link clicked, which is what maps to an AFCT assignment. */
  resourceLinkId: string | null;
  targetLinkUri: string | null;
  /** Where to create gradebook columns. Absent when the platform granted no grade scopes. */
  lineItemsUrl: string | null;
  /** Where to read the course roster. Absent when the platform granted no roster scope. */
  membershipsUrl: string | null;
  /** Set when the platform is asking staff to choose content, rather than opening it. */
  deepLink: DeepLinkRequest | null;
  /**
   * The AFCT assignment this link was created for, from the custom claim AFCT put on it during
   * deep linking. Absent on a plain course link, which is why it only ever narrows where a
   * launch lands and never decides whether it is allowed.
   */
  assignmentId: string | null;
};

/**
 * What the token claimed to be, for the one refusal where knowing is the difference between a
 * five-minute fix and an afternoon. Unverified by definition: no registration matched, so no key
 * verified it. Diagnostic only, and never used to decide anything.
 */
export type ObservedClaims = { issuer: string; clientId: string; deploymentId: string };

export type LaunchResult =
  | { ok: true; identity: LaunchIdentity }
  | { ok: false; reason: LaunchRefusal; observed?: ObservedClaims };

/**
 * Remote keysets, cached per platform.
 *
 * `createRemoteJWKSet` does its own caching and its own refresh when it meets an unknown `kid`,
 * which is what lets a platform rotate its keys without anyone intervening. Building a new one
 * per launch would throw that away and fetch on every single launch.
 */
const keysetCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function keysetFor(url: string) {
  let keyset = keysetCache.get(url);
  if (!keyset) {
    keyset = createRemoteJWKSet(new URL(url));
    keysetCache.set(url, keyset);
  }
  return keyset;
}

/** Issue the nonce for a login request. Single use is what makes a replayed launch fail. */
export async function issueLaunchNonce(): Promise<string> {
  const { token } = await issueSingleUseToken({
    purpose: 'LTI_LAUNCH_NONCE',
    ttlMs: LAUNCH_NONCE_TTL_MS,
  });
  return token;
}

/** First and last name, from whichever claims the platform chose to send. */
function namesFrom(payload: JWTPayload): { firstName: string | null; lastName: string | null } {
  const given = typeof payload.given_name === 'string' ? payload.given_name : null;
  const family = typeof payload.family_name === 'string' ? payload.family_name : null;
  if (given || family) return { firstName: given, lastName: family };

  // Some platforms send only `name`. Splitting on the first space is wrong for plenty of names,
  // so it is a fallback rather than the rule, and the parts are only ever used to prefill a
  // profile the person can correct.
  const full = typeof payload.name === 'string' ? payload.name.trim() : '';
  if (!full) return { firstName: null, lastName: null };
  const cut = full.indexOf(' ');
  if (cut === -1) return { firstName: full, lastName: null };
  return { firstName: full.slice(0, cut), lastName: full.slice(cut + 1) };
}

// Services live under sibling namespaces (`lti-ags`, `lti-nrps`), not under `lti`. Getting that
// wrong produces a claim that is silently always absent.
function claimObject(
  payload: JWTPayload,
  name: string,
  namespace = 'lti',
): Record<string, unknown> | null {
  const value = payload[`https://purl.imsglobal.org/spec/${namespace}/claim/${name}`];
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function claimString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Verify a launch token and say who it is for.
 *
 * The nonce AFCT issued when it started the launch is consumed here, so validating the same
 * token twice fails the second time. That is the replay case, and it is why this returns a
 * refusal rather than being a pure function.
 */
export async function validateLaunch(opts: { idToken: string }): Promise<LaunchResult> {
  const { idToken } = opts;

  // Unverified, and used for nothing except finding the registration whose key we then verify
  // against. Every one of these claims is proved again below.
  let unverified: JWTPayload;
  try {
    unverified = decodeJwt(idToken);
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  const issuer = claimString(unverified.iss);
  /**
   * Which client id this launch is for.
   *
   * `aud` is usually a plain string. When a platform sends several, the spec says `azp` names
   * the one the token is actually for, and taking the first entry instead would look up the
   * wrong registration. That fails closed rather than dangerously, but it fails a launch that
   * should have worked, which is its own kind of bug.
   *
   * Only used to *find* the registration. `jwtVerify` below checks the audience properly.
   */
  const audience = Array.isArray(unverified.aud)
    ? (claimString(unverified.azp) ?? claimString(unverified.aud[0]))
    : claimString(unverified.aud);
  const deploymentId = claimString(unverified[`${CLAIM}/deployment_id`]);

  if (!issuer || !audience || !deploymentId) return { ok: false, reason: 'malformed' };

  const platform = await prisma.ltiPlatform.findUnique({
    where: {
      issuer_clientId_deploymentId: { issuer, clientId: audience, deploymentId },
    },
  });

  // No registration means nobody has told AFCT this LMS is allowed to launch into it. Refusing
  // by default is the whole point of registration being mutual.
  if (!platform) {
    // The values are echoed back so an administrator can compare them against the registration
    // they typed. Getting one character wrong here is the most common setup failure, and
    // without this the only symptom is a refusal that names nothing.
    return {
      ok: false,
      reason: 'unregistered-platform',
      observed: { issuer, clientId: audience, deploymentId },
    };
  }

  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(idToken, keysetFor(platform.keysetUrl), {
      issuer: platform.issuer,
      audience: platform.clientId,
      clockTolerance: CLOCK_TOLERANCE_S,
    }));
  } catch (error) {
    if (error instanceof joseErrors.JWTExpired) return { ok: false, reason: 'expired' };
    if (error instanceof joseErrors.JWTClaimValidationFailed) {
      return { ok: false, reason: 'bad-signature' };
    }
    return { ok: false, reason: 'bad-signature' };
  }

  // Re-checked against the registration now that the signature is proved. The lookup above used
  // the token's own word for this; this is the check that means something.
  if (claimString(payload[`${CLAIM}/deployment_id`]) !== platform.deploymentId) {
    return { ok: false, reason: 'deployment-mismatch' };
  }

  const messageType = payload[`${CLAIM}/message_type`];
  const isDeepLink = messageType === 'LtiDeepLinkingRequest';
  if (
    (messageType !== 'LtiResourceLinkRequest' && !isDeepLink) ||
    payload[`${CLAIM}/version`] !== '1.3.0'
  ) {
    return { ok: false, reason: 'wrong-message-type' };
  }

  /**
   * A deep-linking request with nowhere to send the answer cannot be completed, and a tool that
   * pretended otherwise would leave staff picking something that silently goes nowhere.
   */
  const settings = claimObject(payload, 'deep_linking_settings', 'lti-dl');
  const returnUrl = settings ? claimString(settings.deep_link_return_url) : null;
  if (isDeepLink && !returnUrl) return { ok: false, reason: 'wrong-message-type' };

  // Consumed rather than compared, so a captured launch replayed a second time finds the nonce
  // already spent. This is the only check here that changes state, and it is deliberately last
  // among the token checks: a launch that fails for another reason should not burn the nonce.
  const nonce = claimString(payload.nonce);
  if (!nonce) return { ok: false, reason: 'replayed' };
  const consumed = await consumeSingleUseToken({ token: nonce, purpose: 'LTI_LAUNCH_NONCE' });
  if (!consumed) return { ok: false, reason: 'replayed' };

  const email = claimString(payload.email)?.trim().toLowerCase();
  // Canvas can be configured not to share an address. There is nothing AFCT can do with a person
  // it cannot name, so this refuses rather than inventing one.
  if (!email) return { ok: false, reason: 'no-email' };

  const context = claimObject(payload, 'context');
  const resourceLink = claimObject(payload, 'resource_link');
  const rawRoles = payload[`${CLAIM}/roles`];

  return {
    ok: true,
    identity: {
      platformId: platform.id,
      subject: String(payload.sub),
      issuer: platform.issuer,
      email,
      ...namesFrom(payload),
      roles: Array.isArray(rawRoles)
        ? rawRoles.filter((r): r is string => typeof r === 'string')
        : [],
      contextId: context ? claimString(context.id) : null,
      contextTitle: context ? (claimString(context.title) ?? claimString(context.label)) : null,
      resourceLinkId: resourceLink ? claimString(resourceLink.id) : null,
      lineItemsUrl: (() => {
        const ags = claimObject(payload, 'endpoint', 'lti-ags');
        return ags ? claimString(ags.lineitems) : null;
      })(),
      membershipsUrl: (() => {
        const nrps = claimObject(payload, 'namesroleservice', 'lti-nrps');
        return nrps ? claimString(nrps.context_memberships_url) : null;
      })(),
      assignmentId: (() => {
        const custom = claimObject(payload, 'custom');
        return custom ? claimString(custom.afct_assignment_id) : null;
      })(),
      deepLink:
        isDeepLink && returnUrl
          ? {
              returnUrl,
              data: settings ? claimString(settings.data) : null,
              multiple: settings?.accept_multiple === true,
            }
          : null,
      targetLinkUri: claimString(payload[`${CLAIM}/target_link_uri`]),
    },
  };
}

/** What to tell an administrator about a refused launch. Says what to do, not what threw. */
export function launchRefusalMessage(reason: LaunchRefusal): string {
  switch (reason) {
    case 'unregistered-platform':
      return 'This LMS is not registered with AFCT, or its client id and deployment id do not match the registration. Check the registration in Admin, System Settings, LTI.';
    case 'expired':
      return 'The launch took too long, or the clocks on the two servers disagree. Try again, and check the server time if it keeps happening.';
    case 'replayed':
      return 'This launch link has already been used. Go back to your LMS and click the link again.';
    case 'no-email':
      return 'Your LMS did not share an email address with AFCT, so you cannot be signed in. An administrator needs to allow AFCT to see email addresses in the LMS privacy settings.';
    case 'deployment-mismatch':
      return 'The launch came from a different deployment than the one registered. Check the deployment id in the registration.';
    case 'wrong-message-type':
      return 'AFCT can only be opened as an assignment or link from your LMS.';
    case 'bad-signature':
    case 'malformed':
    default:
      return 'The launch could not be verified. Ask an administrator to check the AFCT registration in your LMS.';
  }
}
