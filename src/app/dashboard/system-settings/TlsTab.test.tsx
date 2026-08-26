/** @vitest-environment jsdom */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { TlsTab } from './TlsTab';

vi.mock('@/lib/toast', () => ({ showToast: { error: vi.fn(), success: vi.fn() } }));

const METHODS = [
  'Let’s Encrypt',
  'CA-signed certificate',
  'Self-signed certificate',
  'Upload existing certificate',
] as const;

/** Each choice opens its own dialog; the title is how we tell which one it opened. */
const DIALOG_TITLES: Record<(typeof METHODS)[number], RegExp> = {
  'Let’s Encrypt': /Let’s Encrypt/,
  'CA-signed certificate': /certificate signing request|CA-signed/i,
  'Self-signed certificate': /self-signed/i,
  'Upload existing certificate': /upload/i,
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ installed: false }) }),
  );
});

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <TlsTab configuredUrl="https://afct.example.edu" />
    </QueryClientProvider>,
  );
  return screen.getByRole('group', { name: 'Certificate setup method' });
}

describe('TlsTab certificate setup choices', () => {
  it('offers all four methods as real buttons', () => {
    const group = renderTab();

    for (const name of METHODS) {
      // A <button>, so keyboard activation, focus and the accessible name are the
      // platform's rather than something re-implemented on a div.
      const choice = within(group).getByRole('button', { name: new RegExp(name) });
      expect(choice.tagName).toBe('BUTTON');
      expect(choice).toHaveAttribute('type', 'button');
    }
  });

  /*
   * Recommended is guidance, not a state, so it marks exactly one option. Four "recommended"
   * choices would say nothing, and none would leave an administrator to guess which of four
   * routes their ordinary public deployment should take.
   */
  it('marks only Let’s Encrypt as recommended', () => {
    const group = renderTab();

    expect(within(group).getAllByText('Recommended')).toHaveLength(1);
    const letsEncrypt = within(group).getByRole('button', { name: /Let’s Encrypt/ });
    expect(within(letsEncrypt).getByText('Recommended')).toBeVisible();
  });

  it.each(METHODS)('opens the existing workflow for %s', async (name) => {
    const user = userEvent.setup();
    const group = renderTab();

    await user.click(within(group).getByRole('button', { name: new RegExp(name) }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading')).toHaveAccessibleName(DIALOG_TITLES[name]);
  });

  it('describes each choice, not just names it', () => {
    const group = renderTab();

    expect(within(group).getByText(/automatic renewal/)).toBeVisible();
    expect(within(group).getByText(/Generate a CSR/)).toBeVisible();
    expect(within(group).getByText(/Browsers will still show a trust warning/)).toBeVisible();
    expect(within(group).getByText(/private key you already have/)).toBeVisible();
  });

  // It is what makes trying any of them feel safe, so it belongs with the choices.
  it('keeps the rollback reassurance with the choices', () => {
    renderTab();

    const section = screen.getByRole('region', { name: 'Set up a certificate' });
    expect(within(section).getByText(/kept in place, so the site stays reachable/)).toBeVisible();
  });
});
