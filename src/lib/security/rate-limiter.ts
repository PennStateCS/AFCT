// Single source of truth for client IP extraction lives in ip-utils; re-export
// it here so existing importers (auth, signup) keep working.
export { getClientIp } from '@/lib/ip-utils';

// The admin-facing shapes live with the other System Status wire types so a client
// component can import them without pulling this module into the browser bundle.
import type { RateLimitEntry, RateLimitScope } from '@/lib/status/types';

// In-process, per-instance state. This is correct for the supported deployment
// (a single app container, per docs/setup/production.md). It is deliberately NOT
// shared across instances: horizontal scaling would give each instance its own
// counters, multiplying the effective login/signup/enumeration budget and making
// per-account lockout non-global. If the app is ever run multi-instance, back
// these buckets with a shared store (e.g. Redis) or front auth with a platform
// rate limiter. State also resets on restart/deploy, which is acceptable here.
const buckets = new Map<string, RateLimiterBucket>();

const randomBetween = (min: number, max: number) => Math.random() * (max - min) + min;

const LOGIN_IP_CONFIG: BucketConfig = {
  windowMs: 10 * 60 * 1000,
  maxAttempts: 20,
  frictionThreshold: 8,
  challengeThreshold: 14,
  challengeCooldownMs: 90 * 1000,
  blockDurationMs: 30 * 60 * 1000,
  frictionDelayMs: 350,
};

const LOGIN_ACCOUNT_CONFIG: BucketConfig = {
  windowMs: 15 * 60 * 1000,
  maxAttempts: 10,
  frictionThreshold: 4,
  challengeThreshold: 7,
  challengeCooldownMs: 2 * 60 * 1000,
  blockDurationMs: 45 * 60 * 1000,
  frictionDelayMs: 450,
};

const SIGNUP_IP_CONFIG: BucketConfig = {
  windowMs: 30 * 60 * 1000,
  maxAttempts: 12,
  frictionThreshold: 3,
  challengeThreshold: 6,
  challengeCooldownMs: 2 * 60 * 1000,
  blockDurationMs: 60 * 60 * 1000,
  frictionDelayMs: 600,
};

const SIGNUP_IDENTIFIER_CONFIG: BucketConfig = {
  windowMs: 24 * 60 * 60 * 1000,
  maxAttempts: 3,
  frictionThreshold: 2,
  challengeThreshold: 3,
  challengeCooldownMs: 10 * 60 * 1000,
  blockDurationMs: 6 * 60 * 60 * 1000,
  frictionDelayMs: 750,
};

// Starting an LTI launch is unauthenticated by necessity and writes two single-use rows per
// request, so an open endpoint is an invitation to fill a table. Sized for a real class rather
// than a login form: a lecture theatre opening AFCT at once is normal traffic, and one IP is
// often a whole campus behind NAT. Only "ok" or "blocked": there is no person here to challenge,
// the caller is an LMS following a redirect.
const LTI_LOGIN_IP_CONFIG: BucketConfig = {
  windowMs: 5 * 60 * 1000,
  maxAttempts: 300,
  frictionThreshold: Number.MAX_SAFE_INTEGER,
  challengeThreshold: Number.MAX_SAFE_INTEGER,
  challengeCooldownMs: 0,
  blockDurationMs: 10 * 60 * 1000,
  frictionDelayMs: 0,
};

// Email-availability checks are a legitimate signup-form affordance, so the limit is
// generous, but it caps bulk account enumeration from one IP. Only "ok" or "blocked"
// (thresholds above maxAttempts disable friction/challenge for this background call).
const CHECK_EMAIL_IP_CONFIG: BucketConfig = {
  windowMs: 10 * 60 * 1000,
  maxAttempts: 30,
  frictionThreshold: Number.MAX_SAFE_INTEGER,
  challengeThreshold: Number.MAX_SAFE_INTEGER,
  challengeCooldownMs: 0,
  blockDurationMs: 15 * 60 * 1000,
  frictionDelayMs: 0,
};

// Password-reset requests. Two limits, because they stop different things: per address it
// stops one mailbox being flooded by whoever knows it, and per IP it stops a sweep across many
// addresses. Deliberately unchallengeable, because the response is identical whether or not
// the address exists and a captcha would break that.
const PASSWORD_RESET_IP_CONFIG: BucketConfig = {
  windowMs: 15 * 60 * 1000,
  maxAttempts: 20,
  frictionThreshold: Number.MAX_SAFE_INTEGER,
  challengeThreshold: Number.MAX_SAFE_INTEGER,
  challengeCooldownMs: 0,
  blockDurationMs: 15 * 60 * 1000,
  frictionDelayMs: 0,
};

const PASSWORD_RESET_IDENTIFIER_CONFIG: BucketConfig = {
  windowMs: 15 * 60 * 1000,
  maxAttempts: 5,
  frictionThreshold: Number.MAX_SAFE_INTEGER,
  challengeThreshold: Number.MAX_SAFE_INTEGER,
  challengeCooldownMs: 0,
  blockDurationMs: 15 * 60 * 1000,
  frictionDelayMs: 0,
};

// Per-user cap on avatar replacements. Generous enough for normal edits, but it
// stops one account from churning many multi-MB uploads (each replacement writes a
// file to private storage). Keyed on the actor's user id; never challenges.
const AVATAR_UPLOAD_CONFIG: BucketConfig = {
  windowMs: 10 * 60 * 1000,
  maxAttempts: 20,
  frictionThreshold: Number.MAX_SAFE_INTEGER,
  challengeThreshold: Number.MAX_SAFE_INTEGER,
  challengeCooldownMs: 0,
  blockDurationMs: 10 * 60 * 1000,
  frictionDelayMs: 0,
};

// Guessing a course registration code from a signed-in account. The code space is large,
// but only a limiter makes it matter: without one a student can try codes as fast as the
// database answers. Keyed on the user id, since the caller is always signed in, so a
// shared campus address never locks a whole lab out of joining. Only "ok" or "blocked".
const JOIN_CODE_CONFIG: BucketConfig = {
  windowMs: 15 * 60 * 1000,
  maxAttempts: 10,
  frictionThreshold: Number.MAX_SAFE_INTEGER,
  challengeThreshold: Number.MAX_SAFE_INTEGER,
  challengeCooldownMs: 0,
  blockDurationMs: 15 * 60 * 1000,
  frictionDelayMs: 0,
};

// Guessing the current password from inside a live session. The login lockout does not
// cover this path: it guards signing in, and whoever holds a stolen session is already
// past it, with the change-password form as their oracle for the one credential the
// session does not give them. Charged only when a current password is actually checked,
// so policy fumbles on the new password cost nothing. Matches the login lockout's shape.
const PASSWORD_CHANGE_CONFIG: BucketConfig = {
  windowMs: 15 * 60 * 1000,
  maxAttempts: 5,
  frictionThreshold: Number.MAX_SAFE_INTEGER,
  challengeThreshold: Number.MAX_SAFE_INTEGER,
  challengeCooldownMs: 0,
  blockDurationMs: 15 * 60 * 1000,
  frictionDelayMs: 0,
};

const HUMAN_DELAY_THRESHOLD_MS = 600;

export type LimitReason = 'ip' | 'account';

export type RateLimitDecision =
  | { status: 'ok'; applyFriction: boolean; frictionDelayMs: number }
  | { status: 'challenge'; retryAfterMs: number; reason: LimitReason }
  | { status: 'blocked'; retryAfterMs: number; reason: LimitReason };

type BucketConfig = {
  windowMs: number;
  maxAttempts: number;
  frictionThreshold: number;
  challengeThreshold: number;
  challengeCooldownMs: number;
  blockDurationMs: number;
  frictionDelayMs: number;
};

type RateLimiterBucket = {
  count: number;
  resetAt: number;
  blockedUntil?: number;
  challengeUntil?: number;
  // Observability for the admin System Status view. None of these feed a limit
  // decision; they exist so an administrator can see why an address is restricted,
  // since when, and whether it is still knocking.
  firstHitAt: number;
  lastHitAt: number;
  /** When the current block or challenge cooldown was armed. */
  restrictedAt?: number;
  /** Attempts refused since that cooldown was armed. */
  hitsWhileRestricted: number;
};

type BucketEvaluation =
  | { type: 'blocked'; retryAfterMs: number }
  | { type: 'challenge'; retryAfterMs: number }
  | { type: 'ok'; applyFriction: boolean; frictionDelayMs: number };

const sanitizeKey = (value?: string | null) => {
  if (!value) return 'unknown';
  return value.toLowerCase().trim().slice(0, 200) || 'unknown';
};

const bucketKey = (scope: string, identifier?: string | null) =>
  `${scope}:${sanitizeKey(identifier)}`;

const hydrateBucket = (key: string, config: BucketConfig, now: number) => {
  const existing = buckets.get(key);
  if (existing && now < existing.resetAt) {
    return existing;
  }
  const fresh: RateLimiterBucket = {
    count: 0,
    resetAt: now + config.windowMs,
    firstHitAt: now,
    lastHitAt: now,
    hitsWhileRestricted: 0,
  };
  // A block outlives its counting window (a login IP block runs 30 minutes, the
  // window only 10), so carry any live cooldown onto the fresh bucket. Without
  // this the first attempt after the window rolled over would rehydrate a clean
  // bucket and silently lift a restriction that has not expired.
  if (existing) {
    if (existing.blockedUntil && now < existing.blockedUntil) {
      fresh.blockedUntil = existing.blockedUntil;
    }
    if (existing.challengeUntil && now < existing.challengeUntil) {
      fresh.challengeUntil = existing.challengeUntil;
    }
    if (fresh.blockedUntil || fresh.challengeUntil) {
      fresh.restrictedAt = existing.restrictedAt;
      fresh.firstHitAt = existing.firstHitAt;
      fresh.hitsWhileRestricted = existing.hitsWhileRestricted;
    }
  }
  buckets.set(key, fresh);
  return fresh;
};

const hitBucket = (key: string, config: BucketConfig, now: number): BucketEvaluation => {
  const bucket = hydrateBucket(key, config, now);
  bucket.lastHitAt = now;

  if (bucket.blockedUntil && now < bucket.blockedUntil) {
    bucket.hitsWhileRestricted += 1;
    return { type: 'blocked', retryAfterMs: bucket.blockedUntil - now };
  }

  if (bucket.challengeUntil && now < bucket.challengeUntil) {
    bucket.hitsWhileRestricted += 1;
    return { type: 'challenge', retryAfterMs: bucket.challengeUntil - now };
  }

  bucket.count += 1;

  if (bucket.count > config.maxAttempts) {
    bucket.blockedUntil = now + config.blockDurationMs;
    bucket.restrictedAt = now;
    bucket.hitsWhileRestricted = 0;
    return { type: 'blocked', retryAfterMs: config.blockDurationMs };
  }

  if (bucket.count >= config.challengeThreshold) {
    bucket.challengeUntil = now + config.challengeCooldownMs;
    bucket.restrictedAt = now;
    bucket.hitsWhileRestricted = 0;
    return { type: 'challenge', retryAfterMs: config.challengeCooldownMs };
  }

  const shouldFriction = bucket.count >= config.frictionThreshold;
  return { type: 'ok', applyFriction: shouldFriction, frictionDelayMs: config.frictionDelayMs };
};

const combineResults = (
  evaluations: Array<{ evaluation: BucketEvaluation; reason: LimitReason }>,
  interactionMs?: number,
): RateLimitDecision => {
  let frictionDelayMs = 0;
  let hasFriction = false;
  let pendingChallenge: { retryAfterMs: number; reason: LimitReason } | null = null;

  for (const { evaluation, reason } of evaluations) {
    if (evaluation.type === 'blocked') {
      return { status: 'blocked', retryAfterMs: evaluation.retryAfterMs, reason };
    }

    if (evaluation.type === 'challenge') {
      if (!pendingChallenge || evaluation.retryAfterMs > pendingChallenge.retryAfterMs) {
        pendingChallenge = { retryAfterMs: evaluation.retryAfterMs, reason };
      }
      continue;
    }

    if (evaluation.applyFriction) {
      hasFriction = true;
      frictionDelayMs = Math.max(frictionDelayMs, evaluation.frictionDelayMs);
    }
  }

  if (pendingChallenge) {
    return {
      status: 'challenge',
      retryAfterMs: pendingChallenge.retryAfterMs,
      reason: pendingChallenge.reason,
    };
  }

  if (
    typeof interactionMs === 'number' &&
    interactionMs >= 0 &&
    interactionMs < HUMAN_DELAY_THRESHOLD_MS
  ) {
    hasFriction = true;
    frictionDelayMs = Math.max(frictionDelayMs, HUMAN_DELAY_THRESHOLD_MS - interactionMs + 150);
  }

  return {
    status: 'ok',
    applyFriction: hasFriction,
    frictionDelayMs: hasFriction ? Math.min(1200, Math.max(250, frictionDelayMs || 300)) : 0,
  };
};

// The bucket map only grows as new IPs/identifiers appear; entries are otherwise removed
// only on a successful login/signup. Without a sweep, a fully-expired bucket whose key is
// never hit again lingers for the life of the process, so the map creeps upward with every
// unique client (one-off IPs, bulk check-email probes, failed logins that never return) and
// only shrinks on restart. Reap fully-expired buckets to keep it bounded by *active* keys.
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
// Hard ceiling so even an active flood of unique keys (all still inside their window, so
// the time-based sweep can't touch them) cannot grow the map without bound. Sized well
// above any legitimate concurrent-client count; a bucket is tiny, so 50k caps this at a
// few MB. Reaching it means abuse, and the oldest entries are evicted (see below).
const MAX_BUCKETS = 50_000;
let lastSweepAt = 0;

/**
 * Removes buckets that carry no live state: their window has reset AND any block or
 * challenge cooldown has fully elapsed. Such a bucket is indistinguishable from a fresh
 * one (hitting the key just rehydrates it), so dropping it changes no decision. A still
 * blocked or challenged bucket is kept, so a sweep can never let a limited client reset
 * early. Exported for tests.
 */
export const sweepExpiredBuckets = (now: number = Date.now()): number => {
  let removed = 0;
  for (const [key, bucket] of buckets) {
    const windowOver = now >= bucket.resetAt;
    const notBlocked = !bucket.blockedUntil || now >= bucket.blockedUntil;
    const notInChallenge = !bucket.challengeUntil || now >= bucket.challengeUntil;
    if (windowOver && notBlocked && notInChallenge) {
      buckets.delete(key);
      removed += 1;
    }
  }
  return removed;
};

// Opportunistic, activity-driven hygiene run on each rate-limited request. Two parts with
// deliberately different cost profiles:
//   1. Hard-cap eviction, every call: evict the oldest entries (Map preserves insertion
//      order) until back under the cap. O(1) amortized per call, so a sustained flood stays
//      cheap. Under normal load the map is far below the cap and this never runs.
//   2. Full expired-entry sweep: O(n), so throttled to once per interval. Reclaims the
//      slow, non-abuse accumulation of stale one-off keys.
// No background timer to start, gate on NODE_ENV, or unref; if traffic stops the map stops
// growing too, so a skipped sweep costs nothing.
const maybeSweep = (now: number) => {
  while (buckets.size > MAX_BUCKETS) {
    const oldest = buckets.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    buckets.delete(oldest);
  }
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;
  sweepExpiredBuckets(now);
};

const ensureEvaluations = (
  configs: Array<{ key: string; config: BucketConfig; reason: LimitReason }>,
  interactionMs?: number,
) => {
  const now = Date.now();
  maybeSweep(now);
  const evaluations = configs.map(({ key, config, reason }) => ({
    evaluation: hitBucket(key, config, now),
    reason,
  }));

  return combineResults(evaluations, interactionMs);
};

export const evaluateLoginRateLimit = (params: {
  ip?: string;
  identifier?: string;
  interactionMs?: number;
  // Admin-configurable per-account lockout policy (System Settings). Overrides
  // the built-in account defaults; the IP-based limits stay fixed.
  accountLimit?: { maxAttempts?: number; blockDurationMs?: number };
}): RateLimitDecision => {
  const configs = [
    { key: bucketKey('login:ip', params.ip), config: LOGIN_IP_CONFIG, reason: 'ip' as LimitReason },
  ];

  if (params.identifier) {
    const accountConfig: BucketConfig = {
      ...LOGIN_ACCOUNT_CONFIG,
      maxAttempts: params.accountLimit?.maxAttempts ?? LOGIN_ACCOUNT_CONFIG.maxAttempts,
      blockDurationMs: params.accountLimit?.blockDurationMs ?? LOGIN_ACCOUNT_CONFIG.blockDurationMs,
    };
    configs.push({
      key: bucketKey('login:account', params.identifier),
      config: accountConfig,
      reason: 'account',
    });
  }

  return ensureEvaluations(configs, params.interactionMs);
};

// Read the CURRENT login rate-limit state without counting an attempt. The login form
// (via /api/auth/login-check) uses this to classify a failed sign-in, which NextAuth
// only reports as a generic error: is it a captcha challenge, a temporary block, or
// just bad credentials? The authoritative counting stays in the credentials
// `authorize` path; this only observes the flags that path already set.
const peekBucket = (key: string, now: number): BucketEvaluation => {
  const bucket = buckets.get(key);
  if (!bucket) {
    return { type: 'ok', applyFriction: false, frictionDelayMs: 0 };
  }
  // Deliberately not short-circuiting on an elapsed window: a block or challenge
  // outlasts the window that produced it, and the checks below already expire on
  // their own clocks.
  if (bucket.blockedUntil && now < bucket.blockedUntil) {
    return { type: 'blocked', retryAfterMs: bucket.blockedUntil - now };
  }
  if (bucket.challengeUntil && now < bucket.challengeUntil) {
    return { type: 'challenge', retryAfterMs: bucket.challengeUntil - now };
  }
  return { type: 'ok', applyFriction: false, frictionDelayMs: 0 };
};

// No `accountLimit` here: a peek only reads the block/challenge flags the counting
// path already set, so the configured thresholds cannot change its answer.
export const peekLoginRateLimit = (params: {
  ip?: string;
  identifier?: string;
}): RateLimitDecision => {
  const now = Date.now();
  const evaluations = [
    {
      evaluation: peekBucket(bucketKey('login:ip', params.ip), now),
      reason: 'ip' as LimitReason,
    },
  ];
  if (params.identifier) {
    evaluations.push({
      evaluation: peekBucket(bucketKey('login:account', params.identifier), now),
      reason: 'account' as LimitReason,
    });
  }
  return combineResults(evaluations);
};

export const evaluateSignupRateLimit = (params: {
  ip?: string;
  identifier?: string;
  interactionMs?: number;
}): RateLimitDecision => {
  const configs = [
    {
      key: bucketKey('signup:ip', params.ip),
      config: SIGNUP_IP_CONFIG,
      reason: 'ip' as LimitReason,
    },
  ];

  if (params.identifier) {
    configs.push({
      key: bucketKey('signup:identifier', params.identifier),
      config: SIGNUP_IDENTIFIER_CONFIG,
      reason: 'account',
    });
  }

  return ensureEvaluations(configs, params.interactionMs);
};

/**
 * Limits for a password-reset request, keyed on both the IP and the address asked about.
 *
 * A blocked request must still answer exactly as an allowed one does. The whole design of this
 * endpoint is that its response never reveals whether an address has an account, and a
 * different answer when rate-limited would give that away for free.
 */
export const evaluatePasswordResetRateLimit = (params: {
  ip?: string;
  identifier?: string;
}): RateLimitDecision => {
  const configs = [
    {
      key: bucketKey('password-reset:ip', params.ip),
      config: PASSWORD_RESET_IP_CONFIG,
      reason: 'ip' as LimitReason,
    },
  ];

  if (params.identifier) {
    configs.push({
      key: bucketKey('password-reset:identifier', params.identifier),
      config: PASSWORD_RESET_IDENTIFIER_CONFIG,
      reason: 'account',
    });
  }

  return ensureEvaluations(configs);
};

/**
 * IP-based limit for the unauthenticated email-availability check. Returns `blocked`
 * once an IP exceeds the (generous) window budget, so the endpoint can't be used to
 * bulk-enumerate registered accounts. Never challenges; it's a background form check.
 */
export const evaluateCheckEmailRateLimit = (params: { ip?: string }): RateLimitDecision =>
  ensureEvaluations([
    {
      key: bucketKey('check-email:ip', params.ip),
      config: CHECK_EMAIL_IP_CONFIG,
      reason: 'ip' as LimitReason,
    },
  ]);

/**
 * Per-IP limit on starting an LTI launch.
 *
 * Generous on purpose: a class opening an assignment together is ordinary, and a campus can
 * share one address. It exists to stop an endpoint that writes rows on an unauthenticated
 * request from being used to fill a table, not to police students.
 */
export const evaluateLtiLoginRateLimit = (params: { ip?: string }): RateLimitDecision =>
  ensureEvaluations([
    {
      key: bucketKey('lti-login:ip', params.ip),
      config: LTI_LOGIN_IP_CONFIG,
      reason: 'ip' as LimitReason,
    },
  ]);

/**
 * Per-user limit for avatar replacements (both self-serve `/api/me` and admin
 * `/api/users/[id]`). Returns `blocked` once a user exceeds the window budget, so
 * the endpoints can't be used to churn large uploads. Keyed on the actor's id.
 */
export const evaluateAvatarUploadRateLimit = (params: { identifier?: string }): RateLimitDecision =>
  ensureEvaluations([
    {
      key: bucketKey('avatar-upload', params.identifier),
      config: AVATAR_UPLOAD_CONFIG,
      reason: 'account' as LimitReason,
    },
  ]);

/**
 * Per-user limit on join-code attempts, hits and misses alike (a legitimate student
 * joins a course once or twice a term, so charging successes costs nobody anything).
 */
export const evaluateJoinCodeRateLimit = (params: { identifier?: string }): RateLimitDecision =>
  ensureEvaluations([
    {
      key: bucketKey('join-code', params.identifier),
      config: JOIN_CODE_CONFIG,
      reason: 'account' as LimitReason,
    },
  ]);

/**
 * Per-user limit on proving the current password in the change-password form. See the
 * config note: this is the brute-force path the login lockout cannot see.
 */
export const evaluatePasswordChangeRateLimit = (params: {
  identifier?: string;
}): RateLimitDecision =>
  ensureEvaluations([
    {
      key: bucketKey('password-change', params.identifier),
      config: PASSWORD_CHANGE_CONFIG,
      reason: 'account' as LimitReason,
    },
  ]);

export const applyBotFriction = async (delayMs?: number) => {
  if (!delayMs || delayMs <= 0) {
    return;
  }
  const boundedDelay = delayMs + randomBetween(50, 200);
  await new Promise((resolve) => setTimeout(resolve, boundedDelay));
};

export const clearBucketsFor = (keys: string[]) => {
  keys.forEach((key) => buckets.delete(key));
};

export const recordLoginSuccess = (params: { ip?: string; identifier?: string }) => {
  const keys = [bucketKey('login:ip', params.ip)];
  if (params.identifier) {
    keys.push(bucketKey('login:account', params.identifier));
  }
  clearBucketsFor(keys);
};

export const recordSignupSuccess = (params: { ip?: string; identifier?: string }) => {
  const keys = [bucketKey('signup:ip', params.ip)];
  if (params.identifier) {
    keys.push(bucketKey('signup:identifier', params.identifier));
  }
  clearBucketsFor(keys);
};

export const formatRetryAfterSeconds = (ms: number) => Math.max(1, Math.ceil(ms / 1000)).toString();

/* -------------------- admin inspection -------------------- */

/**
 * The bucket scopes keyed on a client IP address, with the plain-language reason an
 * administrator sees on System Status. The other scopes (`login:account`,
 * `signup:identifier`, `avatar-upload`) are keyed on an email or a user id, not an
 * address, so they are deliberately absent: this surface only ever exposes IPs.
 */
const IP_SCOPES: Record<RateLimitScope, { label: string; reason: string }> = {
  'login:ip': {
    label: 'Sign-in attempts',
    reason: 'Too many failed sign-in attempts from this address',
  },
  'signup:ip': {
    label: 'Account sign-ups',
    reason: 'Too many account sign-up attempts from this address',
  },
  'check-email:ip': {
    label: 'Email availability checks',
    reason: 'Too many email availability checks from this address',
  },
};

/** The same scopes as a tuple, for building the API's request schema. */
export const RATE_LIMIT_SCOPES = [
  'login:ip',
  'signup:ip',
  'check-email:ip',
] as const satisfies readonly RateLimitScope[];

const scopeOf = (key: string): RateLimitScope | null =>
  RATE_LIMIT_SCOPES.find((scope) => key.startsWith(`${scope}:`)) ?? null;

const toEntry = (key: string, bucket: RateLimiterBucket, now: number): RateLimitEntry | null => {
  const scope = scopeOf(key);
  if (!scope) return null;

  const blocked = bucket.blockedUntil !== undefined && now < bucket.blockedUntil;
  const challenged = bucket.challengeUntil !== undefined && now < bucket.challengeUntil;
  if (!blocked && !challenged) return null;

  const meta = IP_SCOPES[scope];
  return {
    id: key,
    ip: key.slice(scope.length + 1),
    scope,
    scopeLabel: meta.label,
    state: blocked ? 'blocked' : 'challenge',
    reason: meta.reason,
    startedAt: bucket.restrictedAt ?? bucket.firstHitAt,
    expiresAt: (blocked ? bucket.blockedUntil : bucket.challengeUntil) as number,
    attempts: bucket.count,
    attemptsWhileRestricted: bucket.hitsWhileRestricted,
    lastAttemptAt: bucket.lastHitAt,
  };
};

/**
 * Every IP currently under a block or challenge cooldown, newest restriction first.
 * Reads the live in-process map, so it reflects only this instance and resets with it.
 */
export const listRestrictedIps = (now: number = Date.now()): RateLimitEntry[] => {
  const entries: RateLimitEntry[] = [];
  for (const [key, bucket] of buckets) {
    const entry = toEntry(key, bucket, now);
    if (entry) entries.push(entry);
  }
  return entries.sort((a, b) => b.startedAt - a.startedAt);
};

/**
 * Lifts one IP restriction ahead of its expiry, returning the entry as it stood so the
 * caller can record what was cleared. Returns null when that address is not currently
 * restricted, which makes a double-submit a no-op rather than a silent success.
 */
export const clearRestrictedIp = (params: {
  scope: RateLimitScope;
  ip: string;
  now?: number;
}): RateLimitEntry | null => {
  const now = params.now ?? Date.now();
  const key = bucketKey(params.scope, params.ip);
  const bucket = buckets.get(key);
  if (!bucket) return null;
  const entry = toEntry(key, bucket, now);
  if (!entry) return null;
  buckets.delete(key);
  return entry;
};

export const __dangerousResetRateLimiter = () => {
  buckets.clear();
  lastSweepAt = 0;
};

/** Current number of live buckets. Test-only observability for the cap/sweep. */
export const __bucketCount = () => buckets.size;
