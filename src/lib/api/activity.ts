import type { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  createEnhancedActivityLog,
  type EnhancedActivityLogData,
} from '@/lib/activity-log-utils';
import { apiError } from './http';

/**
 * Records a SECURITY denial in the audit log and returns a 403 Forbidden. This is
 * the single home for the "log the `*_DENIED` event, then return Forbidden" block
 * that was copy-pasted across ~30 handlers.
 */
export async function logDenial(
  req: Request,
  data: {
    userId?: string | null;
    action: string;
    courseId?: string | null;
    metadata?: EnhancedActivityLogData['metadata'];
  },
): Promise<NextResponse> {
  await createEnhancedActivityLog(prisma, req, {
    userId: data.userId ?? null,
    action: data.action,
    severity: 'SECURITY',
    ...(data.courseId ? { courseId: data.courseId } : {}),
    metadata: data.metadata ?? {},
  });
  return apiError(403, 'Forbidden');
}

/**
 * Records an operational failure at ERROR severity, normalizing the thrown value
 * into a message string (the `err instanceof Error ? err.message : 'unknown error'`
 * ternary that was repeated 20+ times). Returns nothing — the caller chooses its
 * own response (error bodies still vary intentionally by route).
 */
export async function logError(
  req: Request,
  data: {
    userId?: string | null;
    action: string;
    error: unknown;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await createEnhancedActivityLog(prisma, req, {
    userId: data.userId ?? null,
    action: data.action,
    severity: 'ERROR',
    metadata: {
      ...(data.metadata ?? {}),
      error: data.error instanceof Error ? data.error.message : 'unknown error',
    },
  });
}
