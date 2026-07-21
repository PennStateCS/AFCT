# Login protection

AFCT throttles authentication to slow down password guessing and account enumeration.
Two independent layers work together, plus an optional captcha step:

- **Per-account lockout** — tied to the email being signed in to. Admin-configurable,
  and the resulting lock is persisted so it survives a restart.
- **Per-IP rate limiting** — tied to the client IP. Fixed limits, held in memory.

For each sign-in attempt the strictest outcome across the buckets wins: if either the
account or the IP bucket is **blocked**, the attempt is blocked; otherwise a **challenge**
(captcha) or added **friction** (a short delay) may apply.

Relevant code: `src/lib/security/rate-limiter.ts` (the buckets), `src/lib/login-policy.ts`
(the admin policy resolver), `src/lib/credentials.ts` (the login gate), and the
`User.lockedUntil` column (the persisted lock).

## Account lockout policy

Failed sign-ins to one account are counted in a per-account bucket keyed on the email
address, over a rolling 15-minute window. Within that window the response escalates:

1. **Friction** after a few failures — a short randomized server-side delay.
2. **Captcha challenge** after more failures — the login form must solve an hCaptcha
   (only when hCaptcha is configured; see the Captcha tab in System Settings).
3. **Lockout** once the attempts reach the configured maximum — the account is blocked
   for the configured duration.

Two parts of this are **admin-configurable** in **System Settings → General**, and
override the built-in account defaults (the IP limits below stay fixed):

| Setting | Env fallback | Default | Range |
| --- | --- | --- | --- |
| Failed logins before lockout | `LOGIN_MAX_ATTEMPTS` | 10 | 3–50 |
| Account lockout duration (minutes) | `LOGIN_LOCKOUT_MINUTES` | 10 | 1–1440 |

The value is resolved from the `SystemSettings` row, then the environment variable, then
the default, and is clamped to the range above so the policy can't be set loose enough to
disable protection (`getLoginLockoutPolicy`).

### Persisted lock

When an account trips the lockout, AFCT also writes the lock to the `User.lockedUntil`
column — a future instant. The login gate rejects the attempt **before** checking the
password whenever `lockedUntil` is in the future, then the lock clears itself once that
instant passes (no background sweeper). Persisting it this way means a lock:

- survives an app restart or redeploy (the in-memory counters do not), and
- is a step toward correctness if AFCT is ever run multi-instance (the in-memory buckets
  are per-instance; see the caveat below).

The write is guarded so only the transition **into** a lock updates the row; subsequent
blocked attempts write nothing. A successful sign-in clears the account and IP counters.

Administrators can end a lock early with **Unlock account** on the
[User Accounts](../admin/user-accounts.md) page; that clears `lockedUntil`.

## IP rate-limiting policy

Attempts from one client IP are counted in per-IP buckets. These limits are **fixed**
(not admin-configurable) and are held in memory. The client IP is derived by
`getClientIp` (`src/lib/ip-utils.ts`).

| Flow | Window | Block after | Block duration | Captcha at |
| --- | --- | --- | --- | --- |
| Login (per IP) | 10 min | 20 attempts | 30 min | 14 |
| Signup (per IP) | 30 min | 12 attempts | 60 min | 6 |
| Signup (per email) | 24 h | 3 attempts | 6 h | 3 |
| Email-availability check (per IP) | 10 min | 30 attempts | 15 min | never |
| Avatar upload (per user) | 10 min | 20 uploads | 10 min | never |

The login form calls `/api/auth/login-check` to *peek* at the current state (without
counting an attempt) so it can tell the user whether a failed sign-in was a captcha
challenge, a temporary block, or just a wrong password — NextAuth otherwise reports only
a generic error. The authoritative counting happens in the credentials `authorize` path.

## Deployment caveat: single instance

The rate-limiter buckets live **in process, per app container**. This is correct for the
supported deployment (a single app container) but has two consequences:

- The IP/account counters reset on restart or redeploy.
- They are **not** shared across instances. Running AFCT multi-instance would give each
  instance its own counters, multiplying the effective budget and making per-account
  lockout non-global. To scale horizontally, back the buckets with a shared store (e.g.
  Redis) or put a platform rate limiter in front of auth.

The persisted account lock (`User.lockedUntil`) is the exception — it lives in the
database, so that portion already behaves correctly across restarts and instances.
