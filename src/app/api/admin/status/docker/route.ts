import { NextResponse } from 'next/server';
import { withAdminAuth } from '@/lib/api/with-auth';
import { collectDocker } from '@/lib/status/docker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Docker tab: container detection (cgroups, /.dockerenv, env hints) and container
 * id / hostname when running inside a container. System administrators only.
 * @openapi
 * summary: Docker/container status
 * responses:
 *   200: { description: "Container info, or { docker: null } when not containerized." }
 *   401: { description: Not signed in. }
 *   403: { description: Not a system administrator. }
 */
export const GET = withAdminAuth(
  async () => {
    const data = await collectDocker();
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
  },
  { deniedAction: 'ADMIN_STATUS_ACCESS_DENIED' },
);
