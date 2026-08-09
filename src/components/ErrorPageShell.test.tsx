/** @vitest-environment jsdom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

import { ErrorPageShell } from './ErrorPageShell';
import NotFoundPage from '@/app/not-found';
import RouteError from '@/app/error';

describe('ErrorPageShell', () => {
  it('names the problem as the page heading', () => {
    render(<ErrorPageShell title="Something went wrong" description="Try again." />);

    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
  });

  it('shows the reference code when there is one', () => {
    render(<ErrorPageShell title="Broken" description="x" digest="abc123" />);

    expect(screen.getByText('abc123')).toBeInTheDocument();
  });

  it('shows no reference code when there is none', () => {
    render(<ErrorPageShell title="Broken" description="x" />);

    expect(screen.queryByText(/Reference code/)).not.toBeInTheDocument();
  });
});

describe('the error pages', () => {
  it('offers a way out of a 404', () => {
    render(<NotFoundPage />);

    expect(screen.getByRole('heading', { name: /Page not found/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Go to dashboard/ })).toHaveAttribute(
      'href',
      '/dashboard',
    );
  });

  /**
   * The message and stack stay on the server. Whoever hits this page may be a student, and a
   * thrown error can carry a file path, a query, or an id that was never theirs to see.
   */
  it('does not put the failure details on screen', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:5432'), {
      digest: 'ref-9',
    });

    render(<RouteError error={error} reset={vi.fn()} />);

    expect(screen.queryByText(/ECONNREFUSED/)).not.toBeInTheDocument();
    expect(screen.queryByText(/10\.0\.0\.5/)).not.toBeInTheDocument();
    // The reference code is what connects this screen to the server log.
    expect(screen.getByText('ref-9')).toBeInTheDocument();
  });

  it('retries in place rather than only offering a link away', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const reset = vi.fn();

    render(<RouteError error={new Error('boom')} reset={reset} />);
    await userEvent.click(screen.getByRole('button', { name: /Try again/ }));

    expect(reset).toHaveBeenCalled();
  });
});
