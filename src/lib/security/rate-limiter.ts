// Single source of truth for client IP extraction lives in ip-utils; re-export
// it here so existing importers (auth, signup) keep working.
export { getClientIp } from '@/lib/ip-utils';

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
  };
  buckets.set(key, fresh);
  return fresh;
};

const hitBucket = (key: string, config: BucketConfig, now: number): BucketEvaluation => {
  const bucket = hydrateBucket(key, config, now);

  if (bucket.blockedUntil && now < bucket.blockedUntil) {
    return { type: 'blocked', retryAfterMs: bucket.blockedUntil - now };
  }

  if (bucket.challengeUntil && now < bucket.challengeUntil) {
    return { type: 'challenge', retryAfterMs: bucket.challengeUntil - now };
  }

  bucket.count += 1;

  if (bucket.count > config.maxAttempts) {
    bucket.blockedUntil = now + config.blockDurationMs;
    return { type: 'blocked', retryAfterMs: config.blockDurationMs };
  }

  if (bucket.count >= config.challengeThreshold) {
    bucket.challengeUntil = now + config.challengeCooldownMs;
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
const peekBucket = (key: string, config: BucketConfig, now: number): BucketEvaluation => {
  const bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    return { type: 'ok', applyFriction: false, frictionDelayMs: 0 };
  }
  if (bucket.blockedUntil && now < bucket.blockedUntil) {
    return { type: 'blocked', retryAfterMs: bucket.blockedUntil - now };
  }
  if (bucket.challengeUntil && now < bucket.challengeUntil) {
    return { type: 'challenge', retryAfterMs: bucket.challengeUntil - now };
  }
  return { type: 'ok', applyFriction: false, frictionDelayMs: 0 };
};

export const peekLoginRateLimit = (params: {
  ip?: string;
  identifier?: string;
  accountLimit?: { maxAttempts?: number; blockDurationMs?: number };
}): RateLimitDecision => {
  const now = Date.now();
  const evaluations = [
    {
      evaluation: peekBucket(bucketKey('login:ip', params.ip), LOGIN_IP_CONFIG, now),
      reason: 'ip' as LimitReason,
    },
  ];
  if (params.identifier) {
    const accountConfig: BucketConfig = {
      ...LOGIN_ACCOUNT_CONFIG,
      maxAttempts: params.accountLimit?.maxAttempts ?? LOGIN_ACCOUNT_CONFIG.maxAttempts,
      blockDurationMs: params.accountLimit?.blockDurationMs ?? LOGIN_ACCOUNT_CONFIG.blockDurationMs,
    };
    evaluations.push({
      evaluation: peekBucket(bucketKey('login:account', params.identifier), accountConfig, now),
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

export const __dangerousResetRateLimiter = () => {
  buckets.clear();
  lastSweepAt = 0;
};

/** Current number of live buckets. Test-only observability for the cap/sweep. */
export const __bucketCount = () => buckets.size;
