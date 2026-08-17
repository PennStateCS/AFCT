/**
 * Finishing a launch from the platform's browser storage.
 *
 * The comparison here is what stands in for the state cookie when a browser refuses to send one,
 * so the cases worth pinning are the refusals: a value that does not match, and a state with
 * nothing waiting on it. Without the second, this endpoint would be a way to complete any launch.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { startLaunch, parkIdToken, findLaunch } from '@/lib/lti/launch-transaction';
import { POST } from './route';

const PLATFORM = 'ltip-state-check';

async function destroyFixtures() {
  await prisma.activityLog.deleteMany({ where: { action: 'LTI_LAUNCH_DENIED' } });
  await prisma.ltiLaunchTransaction.deleteMany({ where: { platformId: PLATFORM } });
  await prisma.ltiPlatform.deleteMany({ where: { id: PLATFORM } });
}

beforeEach(async () => {
  await destroyFixtures();
  await prisma.ltiPlatform.create({
    data: {
      id: PLATFORM,
      name: 'Test Canvas',
      issuer: 'https://canvas.example.test',
      clientId: 'c-state',
      deploymentId: 'd-state',
      authLoginUrl: 'https://canvas.example.test/auth',
      tokenUrl: 'https://canvas.example.test/token',
      keysetUrl: 'https://canvas.example.test/jwks',
    },
  });
});

afterAll(destroyFixtures);

const post = (body: Record<string, string>) =>
  POST(
    new Request('https://afct.test/api/lti/launch/state', {
      method: 'POST',
      body: new URLSearchParams(body),
    }),
  );

/** A launch that arrived without a cookie, with its token waiting. */
async function paused() {
  const { state } = await startLaunch({ platformId: PLATFORM, storageTarget: '_parent' });
  const found = await findLaunch(state);
  if (!found.ok) throw new Error('fixture launch not found');
  await parkIdToken(found.launch.id, 'a-token');
  return state;
}

describe('completing a launch from stored state', () => {
  it('refuses a stored value that is not the launch’s state, and says so in the log', async () => {
    const state = await paused();

    const res = await post({ state, stored: 'something-else' });

    expect(res.status).toBe(400);
    // A SECURITY entry, because the alternative to a browser losing the value is somebody trying
    // to finish a launch they did not start.
    const entry = await prisma.activityLog.findFirst({
      where: { action: 'LTI_LAUNCH_DENIED' },
      select: { severity: true, metadata: true },
    });
    expect(entry?.severity).toBe('SECURITY');
    expect(JSON.stringify(entry?.metadata)).toContain('stored-state-mismatch');
  });

  it('refuses when the browser found nothing stored', async () => {
    const state = await paused();

    expect((await post({ state, stored: '' })).status).toBe(400);
  });

  it('refuses a state with no launch waiting on it', async () => {
    // Otherwise this endpoint would complete any state somebody cared to name.
    expect((await post({ state: 'never-issued', stored: 'never-issued' })).status).toBe(400);
  });

  it('refuses a launch that has no token parked, even with the right state', async () => {
    // Reaching here without having arrived cookie-less first means the pause never happened.
    const { state } = await startLaunch({ platformId: PLATFORM, storageTarget: '_parent' });

    expect((await post({ state, stored: state })).status).toBe(400);
  });

  it('refuses a request that is missing its fields', async () => {
    expect((await post({})).status).toBe(400);
  });
});
