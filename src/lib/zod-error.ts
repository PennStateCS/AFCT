// src/lib/zod-error.ts
import { ZodError } from 'zod';

export type NormalizedIssue = {
  path: string; // dot.notation
  message: string;
  code?: string;
};

export function normalizeZodError(err: unknown): NormalizedIssue[] | null {
  if (!(err instanceof ZodError)) return null;
  return err.issues.map((i) => ({
    path: i.path.join('.'),
    message: i.message,
    code: i.code,
  }));
}

/**
 * Standard JSON payload used by APIs to send validation errors back to clients.
 */
export function validationResponse(err: unknown, init?: ResponseInit) {
  const issues = normalizeZodError(err);
  if (!issues) {
    // Not a zod error; let caller decide how to respond
    return Response.json({ message: 'Validation failed' }, { status: 400, ...init });
  }
  return Response.json({ message: 'Validation failed', issues }, { status: 400, ...init });
}
