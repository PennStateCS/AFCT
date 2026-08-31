/**
 * Getting an access token from an LMS, so AFCT can call its services.
 *
 * This is the other direction of trust, and the first thing that uses AFCT's own keypair. There
 * is no client secret in LTI 1.3: AFCT proves who it is by signing a short-lived assertion with
 * its private key, and the platform verifies that against the keyset it fetched from
 * `/api/lti/jwks`. **That fetch happens on the platform's servers**, which is why an instance
 * the LMS cannot reach fails here and nowhere earlier.
 *
 * Tokens are cached until shortly before they expire. Platforms rate-limit this endpoint, and a
 * grade sync that asked for a new token per score would be both slow and rude.
 */

import { SignJWT, importPKCS8 } from 'jose';
import { getSigningKey, LTI_SIGNING_ALG } from '@/lib/lti/keys';
import { authorisedFetch, authorisedFetchFailureDetail } from '@/lib/lti/authorised-fetch';
import { prisma } from '@/lib/prisma';

/**
 * The AGS scopes, kept apart because the operations are.
 *
 * AGS grants them separately: `lineitem` manages gradebook columns, `score` posts grades. A
 * platform that made the column itself may grant only `score`, and asking for both then has the
 * whole token request refused, so no grade is sent at all. Each operation asks for what it
 * needs; the cache is keyed by scope, so the two live side by side.
 */
export const AGS_LINE_ITEM_SCOPES = [
  'https://purl.imsglobal.org/spec/lti-ags/scope/lineitem',
] as const;

export const AGS_SCORE_SCOPES = ['https://purl.imsglobal.org/spec/lti-ags/scope/score'] as const;

/** Both, for the places that genuinely do both in one breath. */
export const AGS_SCOPES = [...AGS_LINE_ITEM_SCOPES, ...AGS_SCORE_SCOPES] as const;

/**
 * Reading scores back, which AFCT itself never does.
 *
 * Deliberately outside `AGS_SCOPES`, and never passed to `getAccessToken` by the application.
 * It is requested at registration only, so that grade passback can be diagnosed against an LMS
 * nobody here administers: on our own test instances the platform's database can be read
 * directly, which is better evidence, but that is not an option at another institution.
 *
 * Keeping it out of `AGS_SCOPES` is the load-bearing part. Per the note above, a token request
 * naming a scope the platform did not grant is refused whole, so widening the scopes that carry
 * grades with a merely diagnostic one would trade working passback for a convenience.
 */
export const AGS_RESULT_SCOPES = [
  'https://purl.imsglobal.org/spec/lti-ags/scope/result.readonly',
] as const;

/** How long an assertion is good for. Short: it is used once, immediately. */
const ASSERTION_TTL_S = 60;

/** Treat a token as expired this long before it really is, to cover a slow request. */
const EXPIRY_MARGIN_MS = 30_000;

export type AccessTokenRefusal =
  /** AFCT has no signing key, so it cannot prove who it is. */
  | 'no-signing-key'
  /** The platform refused the assertion, or its token endpoint failed. */
  | 'rejected'
  /** The platform could not be reached at all. */
  | 'unreachable';

export type AccessTokenResult =
  { ok: true; token: string } | { ok: false; reason: AccessTokenRefusal; detail?: string };

type CacheEntry = { token: string; expiresAt: number };

/**
 * Cached per platform and scope set.
 *
 * In memory rather than in the database on purpose: a token is short-lived and cheap to
 * replace, and a process that restarts should not be handing out a token it cannot verify the
 * freshness of. Losing the cache costs one extra request.
 */
const cache = new Map<string, CacheEntry>();

/**
 * Forget every cached token, or one platform's.
 *
 * Tokens are minted for a particular client id, audience and endpoint, so editing a
 * registration leaves entries that were valid for the registration as it used to be. They are
 * short-lived and the platform would refuse them anyway, but a refusal reads as "your LMS
 * rejected the grade", which sends an administrator looking in the wrong place after a change
 * they just made. Called when a registration changes, and by tests that need a cold cache.
 */
export function clearAccessTokenCache(platformId?: string): void {
  if (!platformId) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (key.startsWith(`${platformId}:`)) cache.delete(key);
  }
}

/**
 * The signed assertion AFCT presents instead of a client secret.
 *
 * `aud` is the platform's token endpoint, which is what stops an assertion captured by one
 * platform being replayed against another. `iss` and `sub` are both AFCT's client id, which is
 * what the spec asks for and reads oddly until you know that.
 *
 * A platform may name an audience of its own instead, and one does: D2L Brightspace issues a
 * `BrightspaceAudience` separately from its access token URL and refuses an assertion addressed to
 * the endpoint. Canvas, Moodle and Blackboard all want the endpoint, the last confirmed from
 * Blackboard's own sample tool, so the endpoint stays the default and this is the exception.
 */
async function buildAssertion(opts: {
  clientId: string;
  tokenUrl: string;
  tokenAudience?: string | null;
  kid: string;
  privateKey: string;
  deploymentId?: string;
}): Promise<string> {
  const key = await importPKCS8(opts.privateKey, LTI_SIGNING_ALG);

  return (
    // Core 6.2.1 says the assertion SHOULD carry the deployment id. It is optional, and AFCT
    // was conformant without it, but a platform may scope the token it hands back to one
    // deployment and some refuse the request when it is absent.
    new SignJWT(
      opts.deploymentId
        ? { 'https://purl.imsglobal.org/spec/lti/claim/deployment_id': opts.deploymentId }
        : {},
    )
      .setProtectedHeader({ alg: LTI_SIGNING_ALG, kid: opts.kid })
      .setIssuer(opts.clientId)
      .setSubject(opts.clientId)
      .setAudience(opts.tokenAudience || opts.tokenUrl)
      .setIssuedAt()
      .setExpirationTime(`${ASSERTION_TTL_S}s`)
      // Unique per request: platforms reject a repeated jti, which is the point of it.
      .setJti(crypto.randomUUID())
      .sign(key)
  );
}

/**
 * An access token for one platform, from cache when possible.
 *
 * Returns a refusal rather than throwing, because every caller is a background sync that has to
 * record why it failed and carry on rather than crash.
 */
export async function getAccessToken(opts: {
  platformId: string;
  clientId: string;
  tokenUrl: string;
  deploymentId?: string;
  scopes?: readonly string[];
  now?: number;
}): Promise<AccessTokenResult> {
  const scopes = opts.scopes ?? AGS_SCOPES;
  const now = opts.now ?? Date.now();
  const cacheKey = `${opts.platformId}:${scopes.join(' ')}`;

  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt - EXPIRY_MARGIN_MS > now) {
    return { ok: true, token: cached.token };
  }

  const signing = await getSigningKey();
  if (!signing) return { ok: false, reason: 'no-signing-key' };

  // Read here rather than threaded through every caller: this runs only on a cache miss, and
  // the alternative is widening the platform shape passed around by AGS and NRPS. The audience
  // joins it for the same reason, and is null for every platform except D2L.
  const registration = await prisma.ltiPlatform.findUnique({
    where: { id: opts.platformId },
    select: { deploymentId: true, tokenAudience: true },
  });
  const deploymentId = opts.deploymentId ?? registration?.deploymentId;

  const assertion = await buildAssertion({
    clientId: opts.clientId,
    tokenUrl: opts.tokenUrl,
    tokenAudience: registration?.tokenAudience,
    kid: signing.kid,
    privateKey: signing.privateKey,
    deploymentId,
  });

  /**
   * Through the same helper the service calls use, for the same two reasons.
   *
   * A redirect is never followed: this POST carries the signed client assertion in its body,
   * and a 307 or 308 resends that body to wherever the platform pointed. The assertion is a
   * credential minted for one audience, and handing it to another host is the one mistake here
   * that cannot be undone by fixing a setting afterwards.
   *
   * And it is bounded: a token request that never returns holds up a grade or a roster read,
   * and in the worker it holds up the queue behind it.
   */
  const attempt = await authorisedFetch(opts.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: assertion,
      scope: scopes.join(' '),
    }),
  });
  if (!attempt.ok) {
    return {
      ok: false,
      // A platform that redirects its own token endpoint has misconfigured itself, which is a
      // setup problem rather than an outage, so it is reported as a refusal with the detail.
      reason:
        attempt.failure.kind === 'redirected' || attempt.failure.kind === 'insecure'
          ? 'rejected'
          : 'unreachable',
      detail: authorisedFetchFailureDetail(attempt.failure),
    };
  }
  const response = attempt.response;

  if (!response.ok) {
    // The body usually says which of the many setup mistakes this is, and an administrator
    // needs that far more than a status code.
    const detail = await response.text().catch(() => '');
    return { ok: false, reason: 'rejected', detail: detail.slice(0, 500) };
  }

  const body = (await response.json().catch(() => null)) as {
    access_token?: unknown;
    expires_in?: unknown;
    token_type?: unknown;
  } | null;

  const token = typeof body?.access_token === 'string' ? body.access_token : null;
  if (!token) return { ok: false, reason: 'rejected', detail: 'no access_token in the response' };

  /**
   * The type has to be one AFCT can actually use.
   *
   * Every LTI service call sends `Authorization: Bearer`, so a platform answering with another
   * type would have AFCT present the token in a way it was not issued for, and the refusal
   * would arrive later as an unexplained rejection of a grade. Compared case-insensitively:
   * OAuth says the value is case-insensitive, and platforms spell it both ways. An absent
   * `token_type` is accepted, since platforms in the field omit it and the assertion flow has
   * no other type to mean.
   */
  const tokenType = typeof body?.token_type === 'string' ? body.token_type.toLowerCase() : null;
  if (tokenType !== null && tokenType !== 'bearer') {
    return {
      ok: false,
      reason: 'rejected',
      detail: `your LMS issued a ${body?.token_type as string} token, which AFCT cannot use`,
    };
  }

  // Platforms may omit `expires_in`. An hour is the usual default and erring short only costs
  // an extra request.
  /**
   * Platforms may omit it, and some send it as a string. A value that is not a positive number
   * is treated as absent rather than believed: zero or a negative would expire the token before
   * it was used, and every call would mint a new one.
   */
  const statedLifetime = Number(body?.expires_in);
  const lifetimeS = Number.isFinite(statedLifetime) && statedLifetime > 0 ? statedLifetime : 3600;
  cache.set(cacheKey, { token, expiresAt: now + lifetimeS * 1000 });

  return { ok: true, token };
}

/** What to tell an administrator when AFCT cannot get a token. Says what to check. */
export function accessTokenRefusalMessage(reason: AccessTokenRefusal): string {
  switch (reason) {
    case 'no-signing-key':
      return 'AFCT has no signing key, so it cannot identify itself to your LMS. Re-register the LMS in System Settings, LTI.';
    case 'unreachable':
      return 'AFCT could not reach your LMS. Check the token URL in the registration, and that the LMS is reachable from this server.';
    case 'rejected':
    default:
      return 'Your LMS refused AFCT’s credentials. The usual cause is that it cannot read AFCT’s public keyset: it fetches that from its own servers, so AFCT has to be reachable from your LMS.';
  }
}
