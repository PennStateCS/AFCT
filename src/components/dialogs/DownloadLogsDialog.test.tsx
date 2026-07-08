/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DownloadLogsDialog } from './DownloadLogsDialog';

// Render with a fresh QueryClient per test (retry off, no lingering cache) so the
// fields query starts clean each time — mirrors the dashboard QueryClientProvider.
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

// Datetime inputs aren't relevant here — stub to a no-op.
vi.mock('@/components/ui/InputGroup', () => ({
  __esModule: true,
  default: () => <div data-testid="input-group" />,
}));

const toastError = vi.hoisted(() => vi.fn());
vi.mock('@/lib/toast', () => ({
  showToast: { error: toastError, success: vi.fn() },
}));

describe('DownloadLogsDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
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
        '/api/admin/logs/fields',
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

  it('toasts on a failed fields fetch', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      statusText: 'Boom',
      json: async () => ({}),
    });

    renderWithClient(<DownloadLogsDialog open onOpenChange={() => {}} />);

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith('Failed to get log fields');
    });
  });
});
