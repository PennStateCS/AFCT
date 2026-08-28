/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DownloadLogsDialog } from './DownloadLogsDialog';

// Render with a fresh QueryClient per test (retry off, no lingering cache) so the
// fields query starts clean each time, mirrors the dashboard QueryClientProvider.
const renderWithClient = (ui: React.ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

// Heavy child: render the field ids as plain text so we can assert on them without
// driving the real dropdown/checkbox UI.
vi.mock('@/components/ui/SearchableMultiSelect', () => ({
  SearchableMultiSelect: ({ items }: { items: { id: string; label: string }[] }) => (
    <div data-testid="fields">
      {items.map((i) => (
        <span key={i.id}>{i.label}</span>
      ))}
    </div>
  ),
}));

// Datetime inputs aren't relevant here; stub to a no-op.
vi.mock('@/components/ui/InputGroup', () => ({
  __esModule: true,
  default: () => <div data-testid="input-group" />,
}));

import { toastMock } from '@/test/mocks/toast';

vi.mock('@/lib/toast', () => import('@/test/mocks/toast').then((m) => m.toastModuleMock));
const toastError = toastMock.error;

describe('DownloadLogsDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  // The formula test stubs the URL global; without this every later test would find
  // no URL constructor at all.
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not fetch fields while closed', () => {
    renderWithClient(<DownloadLogsDialog open={false} onOpenChange={() => {}} />);

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('fetches fields when opened and renders the field options', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ['action', 'severity', 'timestamp'],
    });

    renderWithClient(<DownloadLogsDialog open onOpenChange={() => {}} />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/admin/logs/export/fields',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    await waitFor(() => {
      expect(screen.getByText('action')).toBeInTheDocument();
      expect(screen.getByText('severity')).toBeInTheDocument();
      expect(screen.getByText('timestamp')).toBeInTheDocument();
    });
  });

  it('shows no field options while the fetch is pending (loading state)', () => {
    // Never-resolving fetch keeps the query in its pending state.
    (global.fetch as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));

    renderWithClient(<DownloadLogsDialog open onOpenChange={() => {}} />);

    // The multiselect is present but has no items yet.
    expect(screen.getByTestId('fields')).toBeInTheDocument();
    expect(screen.queryByText('action')).not.toBeInTheDocument();
  });

  /**
   * The export is opened in a spreadsheet, and a log row's strings are attacker-influenced
   * (a user's own name, the User-Agent header, metadata). A cell that still begins with `=`
   * in the file executes as a formula on the administrator's machine.
   */
  it('neutralizes formula lead-ins before the CSV leaves the browser', async () => {
    let saved = '';
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn((blob: Blob) => {
        // Capture synchronously via the Blob's text() promise; asserted after the click.
        void blob.text().then((t) => {
          saved = t;
        });
        return 'blob:mock';
      }),
      revokeObjectURL: vi.fn(),
    });
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation(async (url: string) =>
      String(url).endsWith('/fields')
        ? { ok: true, json: async () => ['action'] }
        : {
            ok: true,
            json: async () => [
              { action: 'LOGIN_SUCCESS', userFirstName: '=HYPERLINK("http://evil","x")' },
            ],
          },
    );

    const user = userEvent.setup();
    renderWithClient(<DownloadLogsDialog open onOpenChange={() => {}} />);
    await waitFor(() => expect(screen.getByText('action')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Download Logs' }));

    await waitFor(() => {
      expect(saved).toContain("'=HYPERLINK");
    });
    expect(saved).not.toMatch(/(^|[,\n"])=HYPERLINK/);
  });

  it('toasts on a failed fields fetch', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      statusText: 'Boom',
      json: async () => ({}),
    });

    renderWithClient(<DownloadLogsDialog open onOpenChange={() => {}} />);

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith(
        'Could not load the list of log fields. Close and reopen this dialog to try again.',
      );
    });
  });
});
