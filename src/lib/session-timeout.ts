/**
 * Idle-session-timeout math, shared by the edge middleware, the auth callbacks,
 * and the client-side watcher. Everything here is PURE and dependency-free so it
 * is safe to import from the edge runtime (`src/middleware.ts`) — do not add a
 * Prisma or Node import to this file. The cached settings reader that touches the
 * database lives in `session-timeout.server.ts`.
 *
 * Model: `sessionTimeoutMinutes` (a system setting) is the hard idle limit that
 * drives the *client's* warning + auto-logout. The *server's* limit is that plus
 * a small grace margin (`computeServerIdleGraceMs`) so a working client always
 * signs the user out gracefully first; the server rejection is a backstop for
 * clients that aren't running (locked, suspended, JS disabled, tampered).
 */

/** Minutes → milliseconds, guarding against non-finite input. */
export function sessionTimeoutMs(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  return Math.floor(minutes) * 60_000;
}

/**
 * How long before the hard limit to surface the "session expiring" warning. A
 * flat 60s, but never more than half the window (keeps it sane for short limits).
 */
export function computeWarningLeadMs(timeoutMs: number): number {
  return Math.min(60_000, Math.floor(timeoutMs / 2));
}

/**
 * How often an active client pings the server (via `update()`) to refresh its
 * last-activity timestamp. A quarter of the window, clamped to [1min, 10min], and
 * always short enough to land before the warning would show.
 */
export function computeHeartbeatIntervalMs(timeoutMs: number): number {
  const quarter = Math.floor(timeoutMs / 4);
  const clamped = Math.max(60_000, Math.min(600_000, quarter));
  // Never heartbeat so rarely that we'd miss our own warning window.
  const latest = Math.max(1, timeoutMs - computeWarningLeadMs(timeoutMs) - 1);
  return Math.min(clamped, latest);
}

/**
 * Extra slack the server allows on top of the client limit. Covers the gap
 * between a client's last heartbeat and its last real activity (up to one
 * heartbeat interval) plus clock skew, so the server never rejects a user the
 * client still considers active.
 */
export function computeServerIdleGraceMs(timeoutMs: number): number {
  return computeHeartbeatIntervalMs(timeoutMs) + 30_000;
}

/** The idle limit the server enforces for a given setting: client limit + grace. */
export function serverIdleTimeoutMs(minutes: number): number {
  const base = sessionTimeoutMs(minutes);
  if (base <= 0) return 0;
  return base + computeServerIdleGraceMs(base);
}

/**
 * True when a token's last activity is older than its stored idle limit. Returns
 * false when either value is missing (an untracked/legacy token is treated as
 * active rather than being force-logged-out on deploy) or the limit is 0.
 */
export function isSessionIdleExpired(
  lastActivity: number | undefined | null,
  idleTimeoutMs: number | undefined | null,
  now: number,
): boolean {
  if (typeof lastActivity !== 'number' || !Number.isFinite(lastActivity)) return false;
  if (typeof idleTimeoutMs !== 'number' || idleTimeoutMs <= 0) return false;
  return now - lastActivity > idleTimeoutMs;
}
