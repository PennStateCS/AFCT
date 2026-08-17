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
import { consumeLaunch, findLaunch, nonceMatches } from '@/lib/lti/launch-transaction';

/** LTI puts its claims under this prefix. Spelled out once rather than inline everywhere. */
const CLAIM = 'https://purl.imsglobal.org/spec/lti/claim';

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
  /** Expired, not yet valid, or issued in the future, beyond the allowed clock skew. */
  | 'expired'
  /** The nonce is unknown, already spent, or timed out. A replayed launch lands here. */
  | 'replayed'
  /** Not an LTI 1.3 resource link launch. */
  | 'wrong-message-type'
  /** The deployment id in the token disagrees with the registration matched. */
  | 'deployment-mismatch'
  /** The platform sent no email, so AFCT cannot identify or create a person. */
  | 'no-email'
  /** A claim LTI Core requires is missing, so the launch is not one AFCT can trust. */
  | 'missing-claims'
  /**
   * A deep linking request whose settings are missing or malformed. Separate from
   * `missing-claims` because what an administrator has to look at is different: the settings
   * come from how the placement is configured, not from what the LMS shares about a person.
   */
  | 'deep-link-settings'
  /**
   * The platform said it will not take a link to a resource, which is the only thing AFCT has
   * to offer. Not malformed, just a placement AFCT cannot answer.
   */
  | 'content-type-not-accepted'
  /**
   * The launch identifies nobody. LTI allows this, and AFCT cannot use it: choosing an
   * assignment means knowing whose courses to offer. An AFCT policy, not a protocol failure,
   * which is why it is its own reason rather than `missing-claims`.
   */
  | 'anonymous-launch';

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
  /**
   * Whether the platform will take more than one item back: true, false, or null for a request
   * that did not say. DL 2.0 gives it no default when absent, so it gets the same three states
   * as `acceptLineItem` rather than a guess.
   *
   * AFCT returns one assignment per deep linking response. This says what the platform *permits*,
   * not what AFCT has to send, so it changes nothing about the current single-selection picker;
   * it is kept and stored because it is the platform's own statement of what it supports, and
   * multi-assignment selection would need it.
   */
  acceptMultiple: boolean | null;
  /** The content types the platform will take. Required by DL 2.0, so never empty here. */
  acceptTypes: string[];
  /**
   * How the platform is prepared to display what it is given (`iframe`, `window`, `embed`).
   * Required by DL 2.0. AFCT has nothing to decide from it yet, but it is kept rather than
   * dropped: a required part of the request should survive the round trip.
   */
  acceptPresentationDocumentTargets: string[];
  /**
   * Whether a gradebook column may come with the link.
   *
   * Three states, not two. DL 2.0 says of an absent `accept_lineitem` that "no assumption can
   * be made about the support of line items", so `null` is not the same as `true` and must not
   * be collapsed into it. AFCT sends a line item only on an explicit `true`.
   */
  acceptLineItem: boolean | null;
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
  /**
   * The column this particular link already has, when the platform names it.
   *
   * AGS puts `lineitem` beside `lineitems` on a resource link launch that the platform has
   * already bound a column to. It is worth more than the container: it is the platform saying
   * *this* is the column for *this* link, so a grade needs no search, cannot pick the wrong one,
   * and does not depend on the platform supporting a `resource_id` filter. Absent on a launch
   * with no resource link, and on platforms that do not send it.
   */
  lineItemUrl: string | null;
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
 * The strings in an array claim, or null if it is not one.
 *
 * All or nothing, deliberately. This used to filter out whatever was not a string, so
 * `["ltiResourceLink", 123]` became `["ltiResourceLink"]` and a broken request was answered as
 * though it had been well formed. A platform that sends a list it did not mean should be told,
 * not quietly corrected: the whole point of reading these is to do what the platform asked, and
 * a value AFCT had to repair is not what it asked.
 */
function strictStringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (!value.every((entry) => typeof entry === 'string')) return null;
  return value as string[];
}

/**
 * An optional boolean setting, kept honest about which of its three states it is in.
 *
 * `ok: false` is a value that is present and is not a boolean. It has to be told apart from
 * absence, because `settings.x === true` reads `"true"`, `1` and `{}` all as `false`, and
 * `settings.x !== false` reads them all as `true`. Either way a malformed request is answered
 * with a guess, and for `accept_lineitem` that guess decides whether a gradebook column is
 * created.
 */
function strictOptionalBoolean(
  value: unknown,
): { ok: true; value: boolean | null } | { ok: false } {
  if (value === undefined) return { ok: true, value: null };
  if (typeof value === 'boolean') return { ok: true, value };
  // Includes JSON `null`, which is a value the platform sent rather than one it left out.
  return { ok: false };
}

/** The only content type AFCT has to offer, so a platform that will not take it cannot be served. */
const RESOURCE_LINK_TYPE = 'ltiResourceLink';

/**
 * Read the deep linking settings, refusing a request that is missing what DL 2.0 requires.
 *
 * The old reading treated every absent field as "no restriction", which is the wrong default
 * twice over: it accepted a malformed request, and it turned "the platform did not say" into
 * "the platform said yes". Three of these are required, and the specification is explicit that
 * an absent `accept_lineitem` licenses no assumption either way.
 */
function readDeepLinkSettings(
  payload: JWTPayload,
): { ok: true; request: DeepLinkRequest } | { ok: false; reason: LaunchRefusal } {
  const settings = claimObject(payload, 'deep_linking_settings', 'lti-dl');
  if (!settings) return { ok: false, reason: 'deep-link-settings' };

  // Required, and declared a string. Without it there is nowhere to send the answer, and staff
  // would pick an assignment that silently goes nowhere.
  const returnUrl = claimString(settings.deep_link_return_url);
  /**
   * Required, and both declared arrays of strings. Present and correctly typed is the whole
   * structural test: DL 2.0 sets no minimum length on either, and its own migration table maps
   * the older `none` presentation target onto an empty array, so an empty one is a thing a
   * conformant platform sends rather than a broken request.
   *
   * `=== null` rather than a falsy check, because `[]` is falsy in the ways that matter here and
   * an empty array has to reach the questions below rather than being refused as malformed.
   */
  const acceptTypes = strictStringList(settings.accept_types);
  const targets = strictStringList(settings.accept_presentation_document_targets);

  if (!returnUrl || acceptTypes === null || targets === null) {
    return { ok: false, reason: 'deep-link-settings' };
  }

  /**
   * The optional settings AFCT reads. Present and the wrong type is a broken request, not a
   * silent no: `"true"` is a string, and reading it as either boolean answers a platform with
   * something it never said.
   *
   * Only the ones AFCT actually uses are checked. `title`, `text`, `auto_create` and
   * `accept_media_types` are not read anywhere, and refusing a launch over the shape of a value
   * that changes nothing would cost interoperability and buy nothing.
   */
  const acceptMultiple = strictOptionalBoolean(settings.accept_multiple);
  const acceptLineItem = strictOptionalBoolean(settings.accept_lineitem);
  if (!acceptMultiple.ok || !acceptLineItem.ok) {
    return { ok: false, reason: 'deep-link-settings' };
  }

  // Declared a string, and it has to come back to the platform exactly as it arrived. A value of
  // another type cannot be returned faithfully, and platforms reject a response whose `data`
  // does not match, so sending the choice on and having it refused would be the worse outcome.
  if (settings.data !== undefined && claimString(settings.data) === null) {
    return { ok: false, reason: 'deep-link-settings' };
  }

  /**
   * Whether AFCT can answer at all, which is a separate question from whether the request was
   * well formed. A placement that takes only files, or one that takes nothing, is a legitimate
   * thing to configure; AFCT simply has nothing it can offer it. An empty list arrives here too,
   * and lands on the same answer for the same reason.
   */
  if (!acceptTypes.includes(RESOURCE_LINK_TYPE)) {
    return { ok: false, reason: 'content-type-not-accepted' };
  }

  return {
    ok: true,
    request: {
      returnUrl,
      data: claimString(settings.data),
      acceptMultiple: acceptMultiple.value,
      acceptTypes,
      acceptPresentationDocumentTargets: targets,
      // Three states. `true` and `false` are what the platform said; `null` is that it did not
      // say, which DL 2.0 leaves as unknown rather than as permission.
      acceptLineItem: acceptLineItem.value,
    },
  };
}

/**
 * Verify a launch token and say who it is for.
 *
 * The nonce AFCT issued when it started the launch is consumed here, so validating the same
 * token twice fails the second time. That is the replay case, and it is why this returns a
 * refusal rather than being a pure function.
 */
export async function validateLaunch(opts: {
  idToken: string;
  /** The state posted back with the token, naming the launch this belongs to. */
  state: string;
}): Promise<LaunchResult> {
  const { idToken, state } = opts;

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
      /**
       * jose checks these only when they are present, so a token with no `exp` would otherwise
       * verify and never expire.
       *
       * `sub` is deliberately *not* here. It used to be, which made every message without one a
       * signature-level failure, and Deep Linking 2.0 does not require it. Whether a subject is
       * needed depends on the message and on what AFCT is going to do with it, so it is decided
       * further down rather than by the verifier.
       */
      requiredClaims: ['exp', 'iat', 'nonce'],
    }));
  } catch (error) {
    if (error instanceof joseErrors.JWTExpired) return { ok: false, reason: 'expired' };
    if (error instanceof joseErrors.JWTClaimValidationFailed) {
      // A claim that is absent is a different problem from one that disagrees, and an
      // administrator chasing a launch needs to be told which.
      if (error.reason === 'missing') return { ok: false, reason: 'missing-claims' };
      // A token that is not valid yet is a clock problem, not a forgery. Reported as a bad
      // signature it sends an administrator to check the registration, which is the wrong
      // place to look and the hardest kind of wrong to recover from.
      if (error.claim === 'nbf') return { ok: false, reason: 'expired' };
      return { ok: false, reason: 'bad-signature' };
    }
    return { ok: false, reason: 'bad-signature' };
  }

  /**
   * `iat` in the future.
   *
   * jose checks `iat` only when `maxTokenAge` is set, so without this a token dated next week
   * verifies and then lives as long as its own `exp` says, which is however long the sender
   * decided. Same tolerance as `exp`, since it is the same clock disagreement.
   */
  const issuedAt = typeof payload.iat === 'number' ? payload.iat : 0;
  if (issuedAt > Date.now() / 1000 + CLOCK_TOLERANCE_S) return { ok: false, reason: 'expired' };

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
   * The deep linking settings, which DL 2.0 requires of a deep linking request and which mean
   * nothing on any other message. Parsed before the launch record is spent, so a placement
   * configured wrongly can be corrected and tried again rather than burning the launch.
   */
  let deepLink: DeepLinkRequest | null = null;
  if (isDeepLink) {
    const parsed = readDeepLinkSettings(payload);
    if (!parsed.ok) return { ok: false, reason: parsed.reason };
    deepLink = parsed.request;
  }

  // Consumed rather than compared, so a captured launch replayed a second time finds the nonce
  // already spent. This is the only check here that changes state, and it is deliberately last
  // among the token checks: a launch that fails for another reason should not burn the nonce.
  const nonce = claimString(payload.nonce);
  if (!nonce) return { ok: false, reason: 'replayed' };

  /**
   * The claims required of *this* message, which is not the same set for both kinds.
   *
   * `target_link_uri` is Core, so both kinds carry it. The rest belong to a resource link
   * launch: Deep Linking 2.0 dropped `sub` outright ("no longer required for Deep Linking
   * Launch for the User") and lists roles as optional, so requiring either of a deep linking
   * request refuses launches a conformant platform is entitled to send.
   */
  const targetLinkUri = claimString(payload[`${CLAIM}/target_link_uri`]);
  if (!targetLinkUri) return { ok: false, reason: 'missing-claims' };

  const subject = claimString(payload.sub);
  const resourceLink = claimObject(payload, 'resource_link');
  const resourceLinkId = resourceLink ? claimString(resourceLink.id) : null;

  /**
   * Roles, which are required of a resource link launch and optional on a deep linking one, and
   * strictly typed on both.
   *
   * The shape is checked the same way the deep linking arrays are. Filtering
   * `["Learner", 123]` down to `["Learner"]` would answer with a list the platform did not send,
   * and roles decide what somebody gets when their roster entry is first created.
   *
   * Only the *shape* is judged here. An unrecognised role URI is perfectly legal, and platforms
   * carry vocabularies AFCT has never heard of, so the values go through untouched and
   * `mapLtiRoles` treats anything it does not know as a student.
   */
  const rolesClaim = payload[`${CLAIM}/roles`];
  const roles = strictStringList(rolesClaim);
  // Present and not an array of strings is a broken message, whichever kind it is.
  if (rolesClaim !== undefined && roles === null) return { ok: false, reason: 'missing-claims' };

  if (!isDeepLink) {
    // Core requires both of a resource link launch. Roles may be an empty array, but the claim
    // itself has to be there.
    if (roles === null || !resourceLinkId) {
      return { ok: false, reason: 'missing-claims' };
    }
  }

  /**
   * Everything about this launch has to belong to the login that started it: the same
   * registration, the same nonce, and the same target link URI the platform asked for. Two
   * loose single-use tokens could not express that, which is what this record is for.
   */
  const found = await findLaunch(state);
  if (!found.ok) {
    // A launch left open too long is a slow sign-in, not a replay. Both tell the person to go
    // back and click the link again, so the difference only shows in the log, which is where an
    // administrator works out whether anything is actually wrong.
    return { ok: false, reason: found.reason === 'timed-out' ? 'expired' : 'replayed' };
  }
  const transaction = found.launch;
  if (transaction.platformId !== platform.id) return { ok: false, reason: 'deployment-mismatch' };
  if (!nonceMatches(transaction, nonce)) return { ok: false, reason: 'replayed' };
  // Core: the token's target link URI must equal the one given to the login endpoint. Only
  // checked when the platform sent one, since it is optional on the login request.
  if (transaction.targetLinkUri && transaction.targetLinkUri !== targetLinkUri) {
    return { ok: false, reason: 'missing-claims' };
  }
  // Spent last, and conditionally, so two copies of one launch cannot both succeed.
  if (!(await consumeLaunch(transaction.id))) return { ok: false, reason: 'replayed' };

  /**
   * From here on the checks are AFCT's, not the protocol's, and they are kept apart on purpose.
   *
   * LTI allows a launch that identifies nobody: Core says a tool "must interpret the lack of a
   * `sub` claim as a launch request coming from an anonymous user", and a platform may withhold
   * the email address as well. AFCT cannot act on either. It signs people in, attaches work to
   * an account and shows a member of staff their own courses, none of which is possible without
   * knowing who arrived. So it refuses, under its own names rather than pretending the platform
   * sent a malformed message.
   */
  if (!subject) return { ok: false, reason: 'anonymous-launch' };

  const email = claimString(payload.email)?.trim().toLowerCase();
  // Canvas can be configured not to share an address. There is nothing AFCT can do with a person
  // it cannot name, so this refuses rather than inventing one.
  if (!email) return { ok: false, reason: 'no-email' };

  const context = claimObject(payload, 'context');

  return {
    ok: true,
    identity: {
      platformId: platform.id,
      subject,
      issuer: platform.issuer,
      email,
      ...namesFrom(payload),
      // Optional on a deep linking request, so an absent claim is no roles rather than a refusal.
      roles: roles ?? [],
      contextId: context ? claimString(context.id) : null,
      contextTitle: context ? (claimString(context.title) ?? claimString(context.label)) : null,
      resourceLinkId,
      lineItemsUrl: (() => {
        const ags = claimObject(payload, 'endpoint', 'lti-ags');
        return ags ? claimString(ags.lineitems) : null;
      })(),
      lineItemUrl: (() => {
        const ags = claimObject(payload, 'endpoint', 'lti-ags');
        return ags ? claimString(ags.lineitem) : null;
      })(),
      membershipsUrl: (() => {
        const nrps = claimObject(payload, 'namesroleservice', 'lti-nrps');
        return nrps ? claimString(nrps.context_memberships_url) : null;
      })(),
      assignmentId: (() => {
        const custom = claimObject(payload, 'custom');
        return custom ? claimString(custom.afct_assignment_id) : null;
      })(),
      deepLink,
      targetLinkUri,
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
    case 'missing-claims':
      return 'The launch was missing information LTI requires, so AFCT could not trust it. An administrator needs to check what the LMS is configured to send.';
    case 'deep-link-settings':
      return 'Your LMS asked AFCT to choose something but did not say where to send the answer or what it will accept. An administrator needs to check how the AFCT placement is configured in the LMS.';
    case 'content-type-not-accepted':
      return 'This place in your LMS does not accept links to an assignment, which is the only thing AFCT can add. Add AFCT somewhere that takes an external tool link instead.';
    case 'anonymous-launch':
      return 'Your LMS opened AFCT without saying who you are, so AFCT cannot sign you in. An administrator needs to let AFCT see the user identity in the LMS privacy settings.';
    case 'wrong-message-type':
      return 'AFCT can only be opened as an assignment or link from your LMS.';
    case 'bad-signature':
    case 'malformed':
    default:
      return 'The launch could not be verified. Ask an administrator to check the AFCT registration in your LMS.';
  }
}
