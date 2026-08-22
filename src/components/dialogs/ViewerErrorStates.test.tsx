/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CfgViewerContent } from './CfgViewerDialog';
import { RegexViewerContent } from './RegexViewerDialog';

/**
 * What these two show when the file does not arrive, or arrives damaged.
 *
 * Both used to swallow the failure and return null, so the dialog held nothing but its title.
 * A screen reader reads that as an empty dialog, and CFG and RE are two of the five problem
 * types students submit, so this is a fifth of the work with no error path at all.
 */
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the grammar viewer', () => {
  it('says the file is loading rather than showing nothing', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    );
    render(<CfgViewerContent src="/x.jff" />);

    expect(screen.getByRole('status')).toHaveTextContent(/Loading the grammar/);
  });

  it('reports a failed fetch instead of an empty dialog', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, statusText: 'nope' })),
    );
    render(<CfgViewerContent src="/x.jff" />);

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/could not be loaded/));
  });

  it('survives a file it cannot parse', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, text: async () => 'not xml at all' })),
    );
    render(<CfgViewerContent src="/x.jff" />);

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });
});

describe('the expression viewer', () => {
  it('says the file is loading rather than showing nothing', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    );
    render(<RegexViewerContent src="/x.jff" />);

    expect(screen.getByRole('status')).toHaveTextContent(/Loading the expression/);
  });

  it('reports a failed fetch instead of an empty dialog', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404, statusText: 'gone' })),
    );
    render(<RegexViewerContent src="/x.jff" />);

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/could not be loaded/));
  });

  /** `parseRegex` throws on a file that is not a regular expression. */
  it('survives a file that is not an expression', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, text: async () => '<structure><type>fa</type></structure>' })),
    );
    render(<RegexViewerContent src="/x.jff" />);

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });
});
