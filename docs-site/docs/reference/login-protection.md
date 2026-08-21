# Login protection

AFCT throttles authentication to slow down password guessing and account enumeration.
Two independent layers work together, plus an optional captcha step:

- **Per-account lockout**, tied to the email being signed in to. Admin-configurable,
  and the resulting lock is persisted so it survives a restart.
- **Per-IP rate limiting**, tied to the client IP. Fixed limits, held in memory.

For each sign-in attempt the strictest outcome across the buckets wins: if either the
account or the IP bucket is **blocked**, the attempt is blocked; otherwise a **challenge**
(captcha) or added **friction** (a short delay) may apply.

Relevant code: `src/lib/security/rate-limiter.ts` (the buckets), `src/lib/login-policy.ts`
(the admin policy resolver), `src/lib/credentials.ts` (the login gate), and the
`User.lockedUntil` column (the persisted lock).

## Ways in, and ways back in

Password guessing is only one half of the picture. The other is that **every account must have
at least one way in, and every install at least one way to recover one**, whatever it has
switched on. AFCT is meant to run with or without a mail server, with or without institutional
sign-in, and with or without LTI, so neither can be assumed.

An account signs in with any of:

- an **AFCT password** (`User.password`, nullable: an account may have none),
- an **institutional account** (a `LinkedIdentity` of kind `OIDC`),
- an **LMS launch** (a `LinkedIdentity` of kind `LTI`).

`unlinkIdentity` refuses to remove the last of these, so no account can be left unreachable.

Recovery works through whichever of these the install has:

| Channel | Needs | Notes |
| --- | --- | --- |
| Reset by email | A mail server | The link is hidden on the sign-in page when there is none. An account with **no** password is sent an explanation of how it signs in, never a link: a reset would quietly add a second way into an account at an institution that chose SSO to avoid exactly that. |
| Setting a first password | Being signed in | For an account that has none. The session is the authority, so this works with no mail server. Governed by **allowLinkedAccountPasswords**; administrators are never governed by it. |
| An administrator | Nothing | Always available, and the only channel on an install with no mail server. Faculty can do the same for plain students on their own roster. |

Two consequences worth knowing:

- **The desktop client signs in with an email and a password** (`/api/client/v1/auth/login`), and
  `verifyCredentials` refuses an account with no password. A student who only ever launches from
  an LMS therefore needs an AFCT password to submit with the client.
- **`temporaryPassword` is only forced when a password exists.** Forcing it on an account with
  none would send somebody to a form asking for a current password they do not have, which the
  dashboard would then bounce them back to indefinitely.

Relevant code: `src/lib/account-credentials.ts` (the shared answers), `src/lib/password-reset.ts`
(which of the two emails goes out), `src/app/api/me/password/route.ts` (set versus change).

## Account lockout policy

Failed sign-ins to one account are counted in a per-account bucket keyed on the email
address, over a rolling 15-minute window. Within that window the response escalates:

1. **Friction** after a few failures: a short randomized server-side delay.
2. **Captcha challenge** after more failures: the login form must solve an hCaptcha
   (only when hCaptcha is configured; see the Captcha tab in System Settings).
3. **Lockout** once the attempts reach the configured maximum: the account is blocked
   for the configured duration.

Two parts of this are **admin-configurable** in **System Settings > General**, and
override the built-in account defaults (the IP limits below stay fixed):

| Setting | Env fallback | Default | Range |
| --- | --- | --- | --- |
| Failed logins before lockout | `LOGIN_MAX_ATTEMPTS` | 10 | 3-50 |
| Account lockout duration (minutes) | `LOGIN_LOCKOUT_MINUTES` | 10 | 1-1440 |

The value is resolved from the `SystemSettings` row, then the environment variable, then
the default, and is clamped to the range above so the policy can't be set loose enough to
disable protection (`getLoginLockoutPolicy`).

### Persisted lock

When an account trips the lockout, AFCT also writes the lock to the `User.lockedUntil`
column, a future instant. The login gate rejects the attempt **before** checking the
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
challenge, a temporary block, or just a wrong password. NextAuth otherwise reports only
a generic error. The authoritative counting happens in the credentials `authorize` path.

A block outlives the window that produced it (a login IP block runs 30 minutes against a
10-minute window), so a bucket whose window has rolled over keeps any live block or
challenge instead of rehydrating clean. Both the counting path and the peek honour this.

### Inspecting and clearing IP limits

**System Status > Rate Limits** lists the IPs currently blocked or challenged on the
instance serving the request, with the reason, when the restriction started, how many
attempts have been counted and refused, and when it expires. An administrator can clear
one early (`POST /api/admin/status/rate-limits/clear`), which is logged at `SECURITY`
severity with the actor, the address, and what was in force when it was cleared.

Each address is enriched by `src/lib/status/rate-limits.ts` from three local sources: a
pure offline classification (`ip-classify.ts`), a reverse-DNS name from the resolver the
server already uses (attempted only for public and carrier-shared addresses, capped by an
800 ms timeout and a bounded 10-minute cache), and a single grouped `ActivityLog` query
for the last 30 days served by the `[ipAddress, timestamp]` index. Enrichment is capped
at 25 addresses per refresh, and a failed activity lookup degrades to `knownActivity:
null` rather than emptying the panel.

No third-party geolocation or WHOIS service is called, deliberately: it would send
visitors' addresses to an outside company, require egress plus an API key, and fail on an
air-gapped install, all for a city name that answers a less useful question than "have we
seen this address before".

Only the IP-keyed scopes are exposed. The buckets keyed on an email address or a user id
(`login:account`, `signup:identifier`, `avatar-upload`) are deliberately absent, so the
tab cannot be used to learn which accounts exist. Ending an account lock is a separate
action on the [User Accounts](../admin/user-accounts.md) page.

## Deployment caveat: single instance

The rate-limiter buckets live **in process, per app container**. This is correct for the
supported deployment (a single app container) but has two consequences:

- The IP/account counters reset on restart or redeploy.
- They are **not** shared across instances. Running AFCT multi-instance would give each
  instance its own counters, multiplying the effective budget and making per-account
  lockout non-global. To scale horizontally, back the buckets with a shared store (e.g.
  Redis) or put a platform rate limiter in front of auth.

The persisted account lock (`User.lockedUntil`) is the exception: it lives in the
database, so that portion already behaves correctly across restarts and instances.
