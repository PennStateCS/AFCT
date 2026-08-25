/** @vitest-environment jsdom */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SignInTab } from './SignInTab';

vi.mock('@/lib/toast', () => ({ showToast: { error: vi.fn() } }));

const REDIRECT = 'https://afct.example.edu/api/auth/callback/oidc';

function renderTab(overrides: Partial<React.ComponentProps<typeof SignInTab>> = {}) {
  render(
    <SignInTab
      enabled={false}
      issuer=""
      clientId=""
      buttonLabel=""
      trustEmail={false}
      allowLinkedAccountPasswords
      setField={vi.fn()}
      disabled={false}
      clientSecret=""
      setClientSecret={vi.fn()}
      clientSecretConfigured={false}
      clientSecretReadable={false}
      clientSecretClear={false}
      setClientSecretClear={vi.fn()}
      redirectUri={REDIRECT}
      {...overrides}
    />,
  );
}

describe('SignInTab', () => {
  /*
   * The redirect URL is a value you hand to somebody else, not a setting you change, so it
   * belongs with the other copyable reference values in the rail rather than as a read-only
   * field in the middle of the form. A read-only InputGroup is what it used to be, and what
   * a refactor would most plausibly turn it back into.
   */
  it('puts the redirect URL in the rail, not in the form', () => {
    renderTab();

    const card = screen.getByRole('complementary', { name: 'For your IT department' });
    expect(within(card).getByText(REDIRECT)).toBeVisible();
    expect(within(card).queryByRole('textbox')).not.toBeInTheDocument();

    const form = screen.getByRole('region', { name: 'Institutional sign-in' });
    expect(form).not.toContainElement(within(card).getByText(REDIRECT));
  });

  it('copies the redirect URL under its own name', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
      writable: true,
    });

    renderTab();
    await user.click(screen.getByRole('button', { name: 'Copy redirect URL' }));

    expect(writeText).toHaveBeenCalledWith(REDIRECT);
  });

  it('keeps the reason it matters beside the value', () => {
    renderTab();

    const card = screen.getByRole('complementary', { name: 'For your IT department' });
    expect(within(card).getByText(/mismatched redirect/)).toBeVisible();
  });

  // The status card is the rail's other occupant; both have to survive together.
  it('shows the status card alongside it', () => {
    renderTab({ enabled: true, clientSecretReadable: true });

    expect(screen.getByRole('complementary', { name: 'Current status' })).toBeInTheDocument();
    expect(screen.getByText('Institutional sign-in is available')).toBeVisible();
  });
});
