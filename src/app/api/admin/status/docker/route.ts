import { statusGet } from '@/lib/api/status-route';
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
export const GET = statusGet(collectDocker);
