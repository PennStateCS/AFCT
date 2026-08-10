import { NextResponse } from 'next/server';
import { listPublicJwks } from '@/lib/lti/keys';

/**
 * AFCT's public keyset, for platforms to verify the tokens AFCT signs.
 *
 * Deliberately public and unauthenticated: a public key is public, and the platform fetching it
 * is a server that has no AFCT session and never will. This is one of the few routes past the
 * edge net, and it is safe because it exposes only the half of each keypair that is meant to be
 * handed out.
 *
 * **Reached from the platform's servers, not a browser.** Nothing in a launch touches it, so an
 * instance the LMS cannot reach looks entirely healthy until the first grade fails to post.
 *
 * Returns an empty key list rather than an error when no key exists. That is a real state, not a
 * fault: an install that has never registered an LMS has never needed a key. A platform reading
 * an empty set gets the same answer as one reading a set with no key it recognises.
 * @openapi
 * summary: AFCT's public keys, for an LMS to verify tokens AFCT signed
 * security: []
 * responses:
 *   200: { description: A JWKS document. Empty when no key has been created yet. }
 */
export async function GET() {
  const keys = await listPublicJwks();

  return NextResponse.json(
    { keys },
    {
      headers: {
        // Platforms cache this. Long enough to spare them refetching on every token request,
        // short enough that a newly published key is picked up without anyone intervening,
        // which is what makes rotation possible at all.
        'Cache-Control': 'public, max-age=300, must-revalidate',
      },
    },
  );
}
