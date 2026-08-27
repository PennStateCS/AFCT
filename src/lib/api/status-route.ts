import { NextResponse } from 'next/server';
import { withAdminAuth } from '@/lib/api/with-auth';

/**
 * Builds the GET handler for one System Status tab.
 *
 * Every status endpoint is the same shape: admin-only, log a denial under one shared
 * action, run a collector, return it uncached. The point of the factory is not the six
 * lines it saves per route, it is that `no-store` and the denial action stop being things
 * a new route can quietly omit. A status route that caches serves stale health data, and
 * one that logs its denials under the wrong action is invisible in a security review, and
 * neither shows up in a diff as a missing line.
 *
 * The `@openapi` block stays in each route file, so documentation generation is unchanged.
 * It must remain the LAST comment before `export const GET`: the generator attaches the
 * immediately preceding comment, so a stray note in between silently replaces the whole
 * documented operation. `npm run docs` catches that, which is why it is in the gate.
 *
 * Collectors that need the request (an origin, a header) take it as an argument; the rest
 * ignore it.
 */
export const statusGet = (collect: (req: Request) => Promise<unknown>) =>
  withAdminAuth(
    async (req) => {
      const data = await collect(req);
      return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
    },
    // One entry for "an administrator was looking at System Status", not one per tab: see
    // the note on viewAction. Its eight backing routes share the action deliberately.
    { deniedAction: 'ADMIN_STATUS_ACCESS_DENIED', viewAction: 'ADMIN_STATUS_VIEWED' },
  );
