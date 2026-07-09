import { NextResponse } from 'next/server';

/**
 * The one canonical JSON error shape for API routes: `{ error: string }` plus the
 * given HTTP status. Replaces the ad-hoc mix of `{ error }`, `{ message }`, and
 * plain-text bodies that had drifted across handlers.
 */
export function apiError(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status });
}
