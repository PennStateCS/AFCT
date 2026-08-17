/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import LtiRegisterPage from './page';

/**
 * The registration page is an async server component, so it is called and its output rendered.
 *
 * What is worth pinning is the two ways somebody arrives here without an LMS behind them: a link
 * with no token, and a link opened in a browser instead of being pasted into the LMS. The second
 * is the mistake people actually make, and a blank screen would leave them stuck.
 */
const renderPage = async (params: Record<string, string>) =>
  render(await LtiRegisterPage({ searchParams: Promise.resolve(params) }));

describe('arriving without a registration in progress', () => {
  it('sends somebody with no token back to AFCT to make one', async () => {
    await renderPage({ openid_configuration: 'https://lms.school.edu/.well-known/x' });

    expect(screen.getByText(/System Settings/)).toBeInTheDocument();
  });

  it('tells somebody who opened the link in a browser to paste it into their LMS', async () => {
    await renderPage({ rt: 'token-1' });

    expect(screen.getByRole('heading', { name: /Start this from your LMS/ })).toBeInTheDocument();
  });
});

it('shows which LMS is asking, by the host that will be registered', async () => {
  await renderPage({
    rt: 'token-1',
    openid_configuration: 'https://lms.school.edu/.well-known/openid-configuration',
  });

  expect(screen.getByText('lms.school.edu')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Register' })).toBeInTheDocument();
});
