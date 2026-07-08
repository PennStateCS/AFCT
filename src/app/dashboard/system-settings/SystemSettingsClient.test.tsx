/** @vitest-environment jsdom */

import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import SystemSettingsClient from './SystemSettingsClient';

// The component is compiled with the classic JSX runtime here (it doesn't import
// React itself and tsconfig uses jsx: "preserve"), so its emitted
// React.createElement calls expect a global React. React is only referenced at
// render time, so setting this before any render is sufficient.
(globalThis as unknown as { React: typeof React }).React = React;

// Spy on the toast helpers so we can assert the success/error branches without
// pulling in sonner's real DOM rendering.
const showToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  loading: vi.fn(),
}));
vi.mock('@/lib/toast', () => ({ showToast }));

// Render with a fresh QueryClient per test (retry off, no lingering cache) so each
// of the three mount queries starts clean.
const renderWithClient = (ui: React.ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

// A fully-populated settings payload matching SystemSettingsResponse. The seeding
// effect reads every one of these fields, so they must all be present.
const settingsPayload = () => ({
  timezone: 'America/New_York',
  maxUploadSizeMb: 42,
  allowSignup: false,
  sessionTimeoutMinutes: 90,
  submissionEvalTimeoutMs: 30_000,
  submissionEvalMaxMemoryMb: 512,
  submissionResubmitCooldownMs: 10_000,
  submissionMaxConcurrent: 3,
  submissionMaxAttempts: 2,
  submissionAnalyzerLimit: 5,
  loginMaxAttempts: 4,
  loginLockoutMinutes: 20,
  backupEnabled: true,
  backupHour: 2,
  backupRetentionDays: 14,
  activityLogRetentionDays: 45,
  hcaptchaSiteKey: 'site-key-123',
  hcaptchaSecretConfigured: true,
});

const tlsPayload = () => ({
  installed: true,
  subject: 'CN=afct.example.edu',
  issuer: 'Trusted CA',
  validTo: '2030-01-01',
  selfSigned: false,
  expired: false,
  pendingCsr: false,
});

const backupsPayload = () => ({
  backups: [
    {
      timestamp: '20260115-030201',
      dumpFile: 'db-20260115-030201.sql.gz',
      dumpSize: 2048,
      filesFile: 'files-20260115-030201.tar.gz',
      filesSize: 4096,
    },
  ],
});

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };
const defer = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

// URL + method router for the three GETs and the PUT. Callers may override the
// settings response with a promise (to control resolution timing) or a value.
type RouterOptions = {
  settings?: unknown | Promise<unknown>;
  settingsOk?: boolean;
  tls?: unknown;
  backups?: unknown;
  putOk?: boolean;
  putBody?: () => unknown;
};

const makeFetch = (opts: RouterOptions = {}) => {
  const putCalls: Array<{ url: string; body: unknown }> = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();

    if (url === '/api/admin/settings' && method === 'GET') {
      const data = opts.settings ?? settingsPayload();
      return {
        ok: opts.settingsOk ?? true,
        json: async () => (data instanceof Promise ? await data : data),
      };
    }
    if (url === '/api/admin/settings' && method === 'PUT') {
      putCalls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
      return { ok: opts.putOk ?? true, json: async () => (opts.putBody ? opts.putBody() : {}) };
    }
    if (url === '/api/admin/settings/tls' && method === 'GET') {
      return { ok: true, json: async () => opts.tls ?? tlsPayload() };
    }
    if (url === '/api/admin/settings/backups' && method === 'GET') {
      return { ok: true, json: async () => opts.backups ?? backupsPayload() };
    }
    throw new Error(`Unexpected fetch: ${method} ${url}`);
  });
  return { fetchMock, putCalls };
};

describe('SystemSettingsClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('seeds the form from GET /api/admin/settings', async () => {
    const { fetchMock } = makeFetch();
    vi.stubGlobal('fetch', fetchMock);

    renderWithClient(<SystemSettingsClient />);

    // The max-upload-size input reflects the seeded response value.
    await waitFor(() => {
      expect(screen.getByLabelText(/Max upload size \(MB\)/)).toHaveValue(42);
    });
    // Another seeded General field for good measure.
    expect(screen.getByLabelText(/Session timeout \(minutes\)/)).toHaveValue(90);

    // The settings GET actually fired with no-store.
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/settings', { cache: 'no-store' });
  });

  it('holds a loading/disabled state until the settings response seeds the form', async () => {
    // Control the settings resolution so we can observe the pre-seed state.
    const gate = defer<unknown>();
    const { fetchMock } = makeFetch({ settings: gate.promise });
    vi.stubGlobal('fetch', fetchMock);

    renderWithClient(<SystemSettingsClient />);

    // Before the settings response resolves: loading announcement is live and the
    // upload input is empty + disabled.
    expect(screen.getByText('Loading system settings')).toBeInTheDocument();
    const uploadInput = screen.getByLabelText(/Max upload size \(MB\)/);
    expect(uploadInput).toBeDisabled();
    expect(uploadInput).toHaveValue(null);

    // Resolve the settings response; the form seeds and enables.
    gate.resolve(settingsPayload());

    await waitFor(() => {
      expect(screen.getByLabelText(/Max upload size \(MB\)/)).toHaveValue(42);
      expect(screen.getByLabelText(/Max upload size \(MB\)/)).not.toBeDisabled();
    });
    expect(screen.queryByText('Loading system settings')).not.toBeInTheDocument();
  });

  it('saves via PUT /api/admin/settings and shows a success toast', async () => {
    const { fetchMock, putCalls } = makeFetch();
    vi.stubGlobal('fetch', fetchMock);

    renderWithClient(<SystemSettingsClient />);

    await waitFor(() => {
      expect(screen.getByLabelText(/Max upload size \(MB\)/)).toHaveValue(42);
    });

    // Edit a field, then submit the associated form via the Save button.
    fireEvent.change(screen.getByLabelText(/Max upload size \(MB\)/), { target: { value: '77' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save system settings' }));

    await waitFor(() => {
      expect(putCalls).toHaveLength(1);
    });

    // The PUT body carries the edited + seeded values.
    expect(putCalls[0].body).toMatchObject({
      timezone: 'America/New_York',
      maxUploadSizeMb: 77,
      allowSignup: false,
      sessionTimeoutMinutes: 90,
      loginMaxAttempts: 4,
      backupEnabled: true,
      hcaptchaSiteKey: 'site-key-123',
    });

    // Success path: success toast fired, no error toast.
    await waitFor(() => {
      expect(showToast.success).toHaveBeenCalledWith('System settings updated successfully.');
    });
    expect(showToast.error).not.toHaveBeenCalled();
  });

  it('shows an error toast when the PUT fails', async () => {
    const { fetchMock } = makeFetch({ putOk: false, putBody: () => ({ error: 'Boom' }) });
    vi.stubGlobal('fetch', fetchMock);

    renderWithClient(<SystemSettingsClient />);

    await waitFor(() => {
      expect(screen.getByLabelText(/Max upload size \(MB\)/)).toHaveValue(42);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save system settings' }));

    await waitFor(() => {
      expect(showToast.error).toHaveBeenCalledWith('Boom');
    });
    expect(showToast.success).not.toHaveBeenCalled();
  });

  it('renders the backups list on the Backups tab', async () => {
    localStorage.setItem('afct.systemSettingsTab', 'backups');
    const { fetchMock } = makeFetch();
    vi.stubGlobal('fetch', fetchMock);

    renderWithClient(<SystemSettingsClient />);

    // The backups query renders a row with the humanized timestamp and download links.
    const cell = await screen.findByText('2026-01-15 03:02:01');
    const row = cell.closest('tr') as HTMLElement;
    const links = within(row).getAllByRole('link', { name: /Download/ });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute(
      'href',
      expect.stringContaining('db-20260115-030201.sql.gz'),
    );
  });

  it('reflects the TLS status from GET /api/admin/settings/tls', async () => {
    localStorage.setItem('afct.systemSettingsTab', 'tls');
    const { fetchMock } = makeFetch();
    vi.stubGlobal('fetch', fetchMock);

    renderWithClient(<SystemSettingsClient />);

    // A trusted, installed cert shows its subject and validity from the response.
    expect(await screen.findByText('Trusted certificate')).toBeInTheDocument();
    expect(screen.getByText('CN=afct.example.edu')).toBeInTheDocument();
    expect(screen.getByText('2030-01-01')).toBeInTheDocument();
  });
});
