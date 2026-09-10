import Link from 'next/link';
import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { validateClientRedirectUri } from '@/lib/client-auth-codes';
import { ClientAuthRequestSchema } from '@/schemas/client';

/**
 * The consent page for the desktop client's browser sign-in (RFC 8252). The client
 * opens the system browser here with a loopback redirect and a PKCE challenge; the
 * signed-in user approves, and the approve route sends a single-use code back to
 * the loopback listener.
 *
 * This page sits outside both the edge net and the dashboard layout, so it
 * enforces its own gates: a session (whose idle and absolute limits the session
 * callback itself enforces), an active account, and `mustChangePassword`, which
 * normally only the dashboard layout checks and without which a temporary-password
 * account could mint a 30-day token from here.
 *
 * Consent phishing is the threat model: any local process can bind a port and open
 * this page, and PKCE does nothing about that. So the page names the ACCOUNT
 * (with a way out for "not you?"), says plainly what approving hands over, and
 * keeps the client-supplied device name de-emphasized, since it is attacker-chosen.
 */
export default async function ClientAuthPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  const session = await auth();
  if (!session?.user || session.user.inactive) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'string') query.set(key, value);
    }
    redirect(`/login?callbackUrl=${encodeURIComponent(`/client-auth?${query.toString()}`)}`);
  }
  if (session.user.mustChangePassword) {
    redirect('/change-password');
  }

  const parsed = ClientAuthRequestSchema.safeParse(params);
  const redirectUri = parsed.success ? validateClientRedirectUri(parsed.data.redirect_uri) : null;

  if (!parsed.success || !redirectUri) {
    // Never redirect on a bad request: an invalid redirect target is exactly the
    // field that cannot be trusted with the answer. Failing here, in front of a
    // person, is the design: a broken client fails at setup, not silently.
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-4 p-6">
        <h1 className="text-2xl font-semibold">This sign-in request is not valid</h1>
        <p className="text-muted-foreground">
          The application that opened this page sent a malformed request, so AFCT cannot
          complete the sign-in. Close this tab and try again from the app. If it keeps
          happening, the app may be out of date.
        </p>
      </main>
    );
  }

  const { state, code_challenge, device_name } = parsed.data;
  const email = session.user.email ?? '';
  const cancelUrl = `${redirectUri}?error=access_denied&state=${encodeURIComponent(state)}`;

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Approve sign-in for the AFCT client?</h1>
        <p className="text-muted-foreground mt-2">
          An application on this computer is asking to sign in to AFCT as{' '}
          <strong>{email}</strong>.
        </p>
        <p className="text-muted-foreground mt-1 text-sm">
          Not you?{' '}
          <Link className="underline" href="/api/auth/signout">
            Sign out
          </Link>{' '}
          and sign in with your own account first.
        </p>
      </div>

      <div className="rounded-md border p-4 text-sm">
        <p>
          Approving gives that application a sign-in token for your account. It will be able
          to see your courses and assignments and submit work as you, until the token expires
          or you revoke it from your account page. It will not know your password.
        </p>
        {device_name ? (
          <p className="text-muted-foreground mt-2">
            The application calls itself &ldquo;{device_name}&rdquo;. Anything can claim any
            name, so only approve if you just asked the AFCT client to sign in.
          </p>
        ) : null}
      </div>

      <form method="POST" action="/client-auth/approve" className="flex items-center gap-3">
        <input type="hidden" name="redirect_uri" value={redirectUri} />
        <input type="hidden" name="state" value={state} />
        <input type="hidden" name="code_challenge" value={code_challenge} />
        <input type="hidden" name="code_challenge_method" value="S256" />
        {device_name ? <input type="hidden" name="device_name" value={device_name} /> : null}
        <button
          type="submit"
          className="bg-primary text-primary-foreground rounded-md px-4 py-2 font-medium"
        >
          Approve sign-in
        </button>
        <a className="text-muted-foreground underline" href={cancelUrl}>
          Cancel
        </a>
      </form>
    </main>
  );
}
