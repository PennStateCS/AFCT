// Server-only resolver for the per-account login lockout policy.
//
// Source of truth is the SystemSettings row (editable in the admin UI). When
// that's unavailable — no row yet, or the DB is unreachable — we fall back to
// the matching env var, then to the built-in default. Values are clamped to
// safe bounds so the policy can't be set loose enough to disable protection.

import { prisma } from '@/lib/prisma';
import {
  clampLoginMaxAttempts,
  clampLoginLockoutMinutes,
  DEFAULT_LOGIN_MAX_ATTEMPTS,
  DEFAULT_LOGIN_LOCKOUT_MINUTES,
} from '@/lib/system-settings';

export type LoginLockoutPolicy = { maxAttempts: number; blockDurationMs: number };

// Returns the env var as a number, or the fallback when it's unset/non-numeric.
const fromEnv = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
};

export async function getLoginLockoutPolicy(): Promise<LoginLockoutPolicy> {
  let row: { loginMaxAttempts: number; loginLockoutMinutes: number } | null = null;

  try {
    row = await prisma.systemSettings.findUnique({
      where: { id: 1 },
      select: { loginMaxAttempts: true, loginLockoutMinutes: true },
    });
  } catch {
    row = null; // DB unavailable — fall back to env/defaults below
  }

  const maxAttempts = clampLoginMaxAttempts(
    row?.loginMaxAttempts ?? fromEnv('LOGIN_MAX_ATTEMPTS', DEFAULT_LOGIN_MAX_ATTEMPTS),
  );
  const minutes = clampLoginLockoutMinutes(
    row?.loginLockoutMinutes ?? fromEnv('LOGIN_LOCKOUT_MINUTES', DEFAULT_LOGIN_LOCKOUT_MINUTES),
  );

  return { maxAttempts, blockDurationMs: minutes * 60_000 };
}
