import StateCheckClient from './StateCheckClient';

/** Reached only from AFCT's own launch endpoint, which redirects here when no cookie arrived. */
export default async function StateCheckPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const { state } = await searchParams;

  if (!state) {
    return (
      <main className="p-6 text-sm">
        This launch could not be continued. Go back to your LMS and open AFCT again.
      </main>
    );
  }

  const { prisma } = await import('@/lib/prisma');
  const { findLaunch } = await import('@/lib/lti/launch-transaction');
  const launch = await findLaunch(state);

  /**
   * The platform's origin, for addressing its storage frame properly rather than with a wildcard.
   * Taken from the registration this launch was started against, never from the URL.
   */
  const platform = launch.ok
    ? await prisma.ltiPlatform.findUnique({
        where: { id: launch.launch.platformId },
        select: { authLoginUrl: true },
      })
    : null;
  const platformOrigin = (() => {
    if (!platform) return null;
    try {
      return new URL(platform.authLoginUrl).origin;
    } catch {
      return null;
    }
  })();

  /**
   * The frame to ask, taken from the launch record rather than the URL.
   *
   * The platform named it at login initiation and AFCT stored it then. Reading it back from a
   * query parameter would let whoever holds the link choose which frame is asked for the
   * launch's state, which is the value this page exists to check.
   */
  return (
    <StateCheckClient
      state={state}
      storageTarget={launch.ok ? launch.launch.storageTarget : null}
      platformOrigin={platformOrigin}
    />
  );
}
