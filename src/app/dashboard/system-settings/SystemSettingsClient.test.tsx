/** @vitest-environment jsdom */

import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  signupAllowedDomains: 'x.edu',
  clock24Hour: false,
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

    // Edit a field, then submit the associated form via the Save button. (Kept under
    // the 50 MB ceiling so the clamp doesn't rewrite it.)
    fireEvent.change(screen.getByLabelText(/Max upload size \(MB\)/), { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save system settings' }));

    await waitFor(() => {
      expect(putCalls).toHaveLength(1);
    });

    // The PUT body carries the edited + seeded values.
    expect(putCalls[0].body).toMatchObject({
      timezone: 'America/New_York',
      maxUploadSizeMb: 40,
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

  // ---------------------------------------------------------------------------
  // Scaffold net: pins the ~19-field form state, unit conversions, cross-tab
  // persistence, and dirty tracking so a future useReducer conversion of this
  // component's state can be verified as behavior-preserving.
  // ---------------------------------------------------------------------------

  // The full set of keys the main Save must send. A dropped field is the most
  // likely regression when the ~30 useState slices become one reducer object.
  const EXPECTED_PAYLOAD_KEYS = [
    'timezone',
    'maxUploadSizeMb',
    'allowSignup',
    'signupAllowedDomains',
    'clock24Hour',
    'sessionTimeoutMinutes',
    'submissionEvalTimeoutMs',
    'submissionResubmitCooldownMs',
    'submissionEvalMaxMemoryMb',
    'submissionMaxConcurrent',
    'submissionMaxAttempts',
    'submissionAnalyzerLimit',
    'loginMaxAttempts',
    'loginLockoutMinutes',
    'backupEnabled',
    'backupHour',
    'backupRetentionDays',
    'activityLogRetentionDays',
    'hcaptchaSiteKey',
  ];

  const seedGeneral = async () => {
    await waitFor(() => {
      expect(screen.getByLabelText(/Max upload size \(MB\)/)).toHaveValue(42);
    });
  };

  it('sends every settings field, with seconds→ms conversions, on save', async () => {
    const { fetchMock, putCalls } = makeFetch();
    vi.stubGlobal('fetch', fetchMock);
    renderWithClient(<SystemSettingsClient />);
    await seedGeneral();

    fireEvent.click(screen.getByRole('button', { name: 'Save system settings' }));
    await waitFor(() => expect(putCalls).toHaveLength(1));
    const body = putCalls[0].body as Record<string, unknown>;

    // No field is silently dropped from the payload.
    for (const key of EXPECTED_PAYLOAD_KEYS) {
      expect(body).toHaveProperty(key);
    }

    // Seeded values carry through, and the seconds-based UI fields convert back to
    // the milliseconds the API expects (30s→30000ms, 10s→10000ms).
    expect(body).toMatchObject({
      timezone: 'America/New_York',
      maxUploadSizeMb: 42,
      allowSignup: false,
      signupAllowedDomains: 'x.edu',
      clock24Hour: false,
      sessionTimeoutMinutes: 90,
      submissionEvalTimeoutMs: 30_000,
      submissionResubmitCooldownMs: 10_000,
      submissionEvalMaxMemoryMb: 512,
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
    });
  });

  it('converts an edited Evaluator (seconds) field to ms in the payload', async () => {
    localStorage.setItem('afct.systemSettingsTab', 'queue');
    const { fetchMock, putCalls } = makeFetch();
    vi.stubGlobal('fetch', fetchMock);
    renderWithClient(<SystemSettingsClient />);

    // Change the resubmit cooldown to 30s (seeded from 10_000ms → 10s).
    const cooldown = await screen.findByLabelText(/Resubmit cooldown \(seconds\)/);
    await waitFor(() => expect(cooldown).toHaveValue(10));
    fireEvent.change(cooldown, { target: { value: '30' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save system settings' }));
    await waitFor(() => expect(putCalls).toHaveLength(1));
    expect((putCalls[0].body as Record<string, unknown>).submissionResubmitCooldownMs).toBe(30_000);
  });

  it('keeps edits when switching tabs (state lives above the tab panels)', async () => {
    const user = userEvent.setup();
    const { fetchMock } = makeFetch();
    vi.stubGlobal('fetch', fetchMock);
    renderWithClient(<SystemSettingsClient />);
    await seedGeneral();

    fireEvent.change(screen.getByLabelText(/Max upload size \(MB\)/), { target: { value: '77' } });

    // Radix unmounts the inactive tab's fields; the edit must survive the round-trip
    // because the form state is held by the parent, not the input.
    await user.click(screen.getByRole('tab', { name: 'Evaluator' }));
    await screen.findByLabelText(/Evaluation timeout \(seconds\)/);
    expect(screen.queryByLabelText(/Max upload size \(MB\)/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'General' }));
    expect(await screen.findByLabelText(/Max upload size \(MB\)/)).toHaveValue(77);
  });

  it('shows the unsaved-changes indicator after an edit and clears it after save', async () => {
    const { fetchMock, putCalls } = makeFetch();
    vi.stubGlobal('fetch', fetchMock);
    renderWithClient(<SystemSettingsClient />);
    await seedGeneral();

    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Max upload size \(MB\)/), { target: { value: '55' } });
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save system settings' }));
    await waitFor(() => expect(putCalls).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument());
  });

  it('canonicalizes the signup domain list before saving', async () => {
    const { fetchMock, putCalls } = makeFetch();
    vi.stubGlobal('fetch', fetchMock);
    renderWithClient(<SystemSettingsClient />);
    await seedGeneral();

    fireEvent.change(screen.getByLabelText(/Allowed signup email domains/), {
      target: { value: 'B.EDU, a.edu , a.edu' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save system settings' }));
    await waitFor(() => expect(putCalls).toHaveLength(1));
    expect((putCalls[0].body as Record<string, unknown>).signupAllowedDomains).toBe('b.edu,a.edu');
  });
});

// A fetch router for the three GET reads plus the TLS POST/DELETE mutations.
type TlsRoutes = { post?: () => Resp; del?: () => Resp };
const makeTlsFetch = (routes: TlsRoutes = {}) => {
  const postBodies: unknown[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    if (url === '/api/admin/settings' && method === 'GET') {
      return { ok: true, json: async () => settingsPayload() };
    }
    if (url === '/api/admin/settings/tls' && method === 'GET') {
      return { ok: true, json: async () => tlsPayload() };
    }
    if (url === '/api/admin/settings/backups' && method === 'GET') {
      return { ok: true, json: async () => backupsPayload() };
    }
    if (url === '/api/admin/settings/tls' && method === 'POST') {
      postBodies.push(JSON.parse(String(init?.body ?? '{}')));
      return routes.post ? routes.post() : { ok: true, json: async () => ({ installed: true }) };
    }
    if (url === '/api/admin/settings/tls' && method === 'DELETE') {
      return routes.del ? routes.del() : { ok: true, json: async () => ({ installed: false }) };
    }
    throw new Error(`Unexpected fetch: ${method} ${url}`);
  });
  return { fetchMock, postBodies };
};

type Resp = { ok: boolean; status?: number; json: () => Promise<unknown> };

describe('SystemSettingsClient — TLS certificate', () => {
  beforeEach(() => {
    localStorage.setItem('afct.systemSettingsTab', 'tls');
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();
  });

  it('reverts to the self-signed certificate on Reset', async () => {
    const { fetchMock } = makeTlsFetch();
    vi.stubGlobal('fetch', fetchMock);
    renderWithClient(<SystemSettingsClient />);

    fireEvent.click(await screen.findByRole('button', { name: 'Reset to self-signed' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/settings/tls',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
    await waitFor(() =>
      expect(showToast.success).toHaveBeenCalledWith('Reverted to the self-signed certificate.'),
    );
  });

  it('toasts the server error when Reset fails', async () => {
    const { fetchMock } = makeTlsFetch({
      del: () => ({ ok: false, status: 500, json: async () => ({ error: 'cannot reset' }) }),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithClient(<SystemSettingsClient />);

    fireEvent.click(await screen.findByRole('button', { name: 'Reset to self-signed' }));
    await waitFor(() => expect(showToast.error).toHaveBeenCalledWith('cannot reset'));
  });

  it('generates a self-signed certificate for the entered hostname', async () => {
    const { fetchMock, postBodies } = makeTlsFetch();
    vi.stubGlobal('fetch', fetchMock);
    renderWithClient(<SystemSettingsClient />);

    fireEvent.click(await screen.findByRole('button', { name: 'Create a self-signed certificate' }));
    fireEvent.change(await screen.findByLabelText(/Hostname \(Common Name\)/), {
      target: { value: 'afct.test.edu' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate self-signed certificate' }));

    await waitFor(() => expect(postBodies).toHaveLength(1));
    expect(postBodies[0]).toMatchObject({ action: 'self-signed', commonName: 'afct.test.edu' });
    await waitFor(() =>
      expect(showToast.success).toHaveBeenCalledWith(
        'Self-signed certificate generated and applied for that hostname.',
      ),
    );
  });

  it('generates and downloads a CSR for the entered hostname', async () => {
    const { fetchMock, postBodies } = makeTlsFetch({
      post: () => ({ ok: true, json: async () => ({ installed: false, pendingCsr: true, csr: 'CSR-DATA' }) }),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithClient(<SystemSettingsClient />);

    fireEvent.click(await screen.findByRole('button', { name: 'Request a CA-signed certificate' }));
    fireEvent.change(await screen.findByLabelText(/Hostname \(Common Name\)/), {
      target: { value: 'afct.test.edu' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate key & CSR' }));

    await waitFor(() => expect(postBodies).toHaveLength(1));
    expect(postBodies[0]).toMatchObject({ action: 'generate-csr', commonName: 'afct.test.edu' });
    // The signed CSR is offered as a download.
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
  });
});

describe('SystemSettingsClient — backups', () => {
  beforeEach(() => {
    localStorage.setItem('afct.systemSettingsTab', 'backups');
  });

  const makeBackupFetch = (postResult?: () => Resp) => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url === '/api/admin/settings' && method === 'GET') {
        return { ok: true, json: async () => settingsPayload() };
      }
      if (url === '/api/admin/settings/tls') return { ok: true, json: async () => tlsPayload() };
      if (url === '/api/admin/settings/backups' && method === 'GET') {
        return { ok: true, json: async () => backupsPayload() };
      }
      if (url === '/api/admin/settings/backups' && method === 'POST') {
        return postResult ? postResult() : { ok: true, json: async () => ({ ok: true }) };
      }
      throw new Error(`Unexpected fetch: ${method} ${url}`);
    });
    return fetchMock;
  };

  it('requests a backup and toasts success on "Back up now"', async () => {
    const fetchMock = makeBackupFetch();
    vi.stubGlobal('fetch', fetchMock);
    renderWithClient(<SystemSettingsClient />);

    const btn = await screen.findByRole('button', { name: 'Back up now' });
    await waitFor(() => expect(btn).toBeEnabled());
    fireEvent.click(btn);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/settings/backups',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    await waitFor(() =>
      expect(showToast.success).toHaveBeenCalledWith(expect.stringContaining('Backup requested')),
    );
  });

  it('toasts when the backup request fails', async () => {
    const fetchMock = makeBackupFetch(() => ({
      ok: false,
      status: 500,
      json: async () => ({ error: 'boom' }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    renderWithClient(<SystemSettingsClient />);

    const btn = await screen.findByRole('button', { name: 'Back up now' });
    await waitFor(() => expect(btn).toBeEnabled());
    fireEvent.click(btn);

    await waitFor(() => expect(showToast.error).toHaveBeenCalled());
  });
});
