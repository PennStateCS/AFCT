import RegisterClient from './RegisterClient';

/**
 * Where an LMS lands when an administrator asks it to register AFCT automatically.
 *
 * Framed by the LMS, and reached without signing in, so this page deliberately does almost
 * nothing. It reads three query parameters, shows what is about to happen, and waits for a
 * person to agree. **Nothing is fetched and nothing is written until they do**: a page that
 * called an address out of its own query string on load would let anybody who found this URL
 * point AFCT's server wherever they liked.
 *
 * The confirmation is not ceremony either. What follows lets an LMS assert who anybody is, and
 * the person looking at this screen is the only one who can say whether the LMS on it is theirs.
 */
export default async function LtiRegisterPage({
  searchParams,
}: {
  searchParams: Promise<{
    rt?: string;
    openid_configuration?: string;
    registration_token?: string;
  }>;
}) {
  const params = await searchParams;
  const token = params.rt ?? '';
  const openidConfiguration = params.openid_configuration ?? '';

  if (!token) {
    return (
      <main className="mx-auto max-w-lg p-6 text-sm">
        <h1 className="mb-2 text-base font-medium">This link is not usable</h1>
        <p className="text-muted-foreground">
          Registration links are created in AFCT. Sign in as an administrator, open System Settings,
          then the LTI tab, and create one there.
        </p>
      </main>
    );
  }

  // The LMS adds this when it starts the flow. Without it the link was opened directly, which is
  // the usual mistake: it belongs in the LMS, not in a browser.
  if (!openidConfiguration) {
    return (
      <main className="mx-auto max-w-lg p-6 text-sm">
        <h1 className="mb-2 text-base font-medium">Start this from your LMS</h1>
        <p className="text-muted-foreground">
          Paste this link into the automatic-registration field in your LMS instead of opening it in
          a browser. Your LMS then reopens it with the details AFCT needs.
        </p>
      </main>
    );
  }

  const host = (() => {
    try {
      return new URL(openidConfiguration).host;
    } catch {
      return null;
    }
  })();

  return (
    <RegisterClient
      token={token}
      openidConfiguration={openidConfiguration}
      registrationToken={params.registration_token ?? null}
      platformHost={host}
    />
  );
}
