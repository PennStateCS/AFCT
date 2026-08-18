/** @vitest-environment jsdom */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import CompleteLaunchClient from './CompleteLaunchClient';

/**
 * The last step of a launch: spend the ticket, get a session, go on.
 *
 * Tickets are single use, so the interesting cases are all second attempts. A reload of a launch
 * that worked must not tell somebody who is signed in that AFCT could not open, and a ticket
 * this browser never completed must still be refused.
 */

const signIn = vi.hoisted(() => vi.fn());
vi.mock('next-auth/react', () => ({ signIn }));

const params = vi.hoisted(() => ({ current: new URLSearchParams() }));
vi.mock('next/navigation', () => ({ useSearchParams: () => params.current }));

const replace = vi.fn();

function show(query: string) {
  params.current = new URLSearchParams(query);
  render(<CompleteLaunchClient />);
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  Object.defineProperty(window, 'location', { value: { replace }, writable: true });
  signIn.mockResolvedValue({ error: undefined });
});

describe('a launch that works', () => {
  it('spends the ticket and goes where the launch said', async () => {
    show('ticket=t-1&next=%2Flti%2Fdeep-link%3Fpending%3Dp-1');

    await waitFor(() =>
      expect(signIn).toHaveBeenCalledWith('lti-launch', { ticket: 't-1', redirect: false }),
    );
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/lti/deep-link?pending=p-1'));
  });

  it('falls back to the dashboard when the launch named nowhere', async () => {
    show('ticket=t-1');

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard'));
  });

  // React's development double-render would otherwise spend the ticket twice, and the second
  // attempt fails on a page that had already succeeded.
  it('signs in once per mount', async () => {
    show('ticket=t-1');

    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(signIn).toHaveBeenCalledTimes(1);
  });
});

/**
 * The bug this file exists for. The ticket is spent because this browser spent it, the person
 * has a session, and the old code showed them a failure page.
 */
describe('reloading a launch that already worked', () => {
  it('goes on instead of reporting a failure', async () => {
    show('ticket=t-1&next=%2Fdashboard%2Fcourses%2Fc-1');
    await waitFor(() => expect(replace).toHaveBeenCalled());

    replace.mockClear();
    signIn.mockClear();
    show('ticket=t-1&next=%2Fdashboard%2Fcourses%2Fc-1');

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard/courses/c-1'));
    // The ticket is spent; asking again would only produce the error page.
    expect(signIn).not.toHaveBeenCalled();
    expect(screen.queryByText('AFCT could not open here')).not.toBeInTheDocument();
  });

  /**
   * Keyed by the ticket, so the marker cannot carry another launch. On a shared browser the next
   * person arrives with their own ticket, which must be spent rather than skipped.
   */
  it('does not skip a different ticket', async () => {
    show('ticket=t-1');
    await waitFor(() => expect(replace).toHaveBeenCalled());

    signIn.mockClear();
    show('ticket=t-2');

    await waitFor(() =>
      expect(signIn).toHaveBeenCalledWith('lti-launch', { ticket: 't-2', redirect: false }),
    );
  });
});

describe('a launch that does not work', () => {
  it('reports a ticket the server refused', async () => {
    signIn.mockResolvedValue({ error: 'CredentialsSignin' });
    show('ticket=bad');

    expect(await screen.findByText('AFCT could not open here')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('reports a missing ticket without asking the server', async () => {
    show('next=%2Fdashboard');

    expect(await screen.findByText('AFCT could not open here')).toBeInTheDocument();
    expect(signIn).not.toHaveBeenCalled();
  });

  // Without this the page sits on "Opening AFCT..." for ever, which reads as a hang.
  it('reports a sign-in that threw', async () => {
    signIn.mockRejectedValue(new Error('offline'));
    show('ticket=t-1');

    expect(await screen.findByText('AFCT could not open here')).toBeInTheDocument();
  });

  it('does not leave a marker behind, so a retry still tries', async () => {
    signIn.mockResolvedValue({ error: 'CredentialsSignin' });
    show('ticket=bad');
    await screen.findByText('AFCT could not open here');

    signIn.mockClear();
    signIn.mockResolvedValue({ error: undefined });
    show('ticket=bad');

    await waitFor(() => expect(signIn).toHaveBeenCalled());
  });
});

/**
 * `next` arrives through the browser, so a crafted link would otherwise turn a launch into an
 * open redirect, which is worth something to anyone phishing a university.
 */
describe('where it will agree to go', () => {
  it.each(['https://evil.test/steal', '//evil.test/steal', 'javascript:alert(1)'])(
    'refuses %s and uses the dashboard',
    async (target) => {
      show(`ticket=t-1&next=${encodeURIComponent(target)}`);

      await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard'));
    },
  );

  it('allows a path on this site', async () => {
    show('ticket=t-1&next=%2Fdashboard%2Fcourses%2Fc-9');

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard/courses/c-9'));
  });
});

/**
 * The failure this actually produces in the wild. A browser inside an LMS frame refuses AFCT
 * its cookies, Auth.js answers MissingCSRF, and the launch stops. The ticket is still unspent,
 * so the way out is the same launch in a first-party tab rather than starting again.
 */
it('offers the same launch in a new tab, carrying the unspent ticket', async () => {
  signIn.mockResolvedValue({ error: 'CredentialsSignin' });

  show('ticket=t-9&next=%2Fdashboard%2Fcourses%2Fc1');

  const link = await screen.findByRole('link', { name: /Open AFCT in a new tab/ });
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('href', '/lti/complete?ticket=t-9&next=%2Fdashboard%2Fcourses%2Fc1');
});
