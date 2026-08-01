/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CfgViewerDialog } from './CfgViewerDialog';

vi.mock('@/components/ui/dialog', () => import('@/test/mocks/ui').then((m) => m.dialogMock));

const grammar = (productions: string) =>
  `<?xml version="1.0"?><structure><type>grammar</type>${productions}</structure>`;

const prod = (left: string, right: string) =>
  `<production><left>${left}</left><right>${right}</right></production>`;

const originalFetch = global.fetch;

const serve = (xml: string) => {
  const fetchMock = vi.fn(async () => ({ ok: true, text: async () => xml }));
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
};

const renderViewer = (props: Partial<React.ComponentProps<typeof CfgViewerDialog>> = {}) =>
  render(
    <CfgViewerDialog
      open
      onOpenChange={vi.fn()}
      src="/api/files/solution/g.jff"
      title="Even Length Strings"
      {...props}
    />,
  );

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('CfgViewerDialog', () => {
  it('renders each production as a left/right row', async () => {
    serve(grammar(prod('S', 'aSb') + prod('S', 'ab')));
    renderViewer();

    await waitFor(() => expect(screen.getByText('aSb')).toBeInTheDocument());
    expect(screen.getByText('ab')).toBeInTheDocument();
    expect(screen.getAllByText('S')).toHaveLength(2);
  });

  it('shows an empty right-hand side as epsilon', async () => {
    // JFLAP writes the epsilon rule as <right></right>, which is empty rather than absent.
    // This is the reported bug: the cell rendered blank, so the answer looked truncated.
    serve(grammar(prod('S', 'aSb') + prod('S', '')));
    renderViewer();

    await waitFor(() => expect(screen.getByText('ε')).toBeInTheDocument());
  });

  it('shows a whitespace-only right-hand side as epsilon', async () => {
    serve(grammar(prod('S', '   ')));
    renderViewer();

    await waitFor(() => expect(screen.getByText('ε')).toBeInTheDocument());
  });

  it('uses the course notation when the course prefers lambda', async () => {
    serve(grammar(prod('S', '')));
    renderViewer({ epsSymbol: 'λ' });

    await waitFor(() => expect(screen.getByText('λ')).toBeInTheDocument());
    expect(screen.queryByText('ε')).not.toBeInTheDocument();
  });

  it('leaves a real right-hand side alone', async () => {
    serve(grammar(prod('A', 'b')));
    renderViewer();

    await waitFor(() => expect(screen.getByText('b')).toBeInTheDocument());
    expect(screen.queryByText('ε')).not.toBeInTheDocument();
  });
});
