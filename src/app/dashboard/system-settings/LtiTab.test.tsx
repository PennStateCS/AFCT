/** @vitest-environment jsdom */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toastMock, resetToastMock } from '@/test/mocks/toast';
import { LtiTab } from './LtiTab';

/**
 * Registering an LMS: the values AFCT hands over, and the ones it takes back. Both halves have
 * to be right or nothing launches.
 */

vi.mock('@/lib/toast', () => import('@/test/mocks/toast').then((m) => m.toastModuleMock));

const platform = {
  id: 'p-1',
  name: 'Canvas',
  issuer: 'https://canvas.test',
  clientId: '10000000000001',
  deploymentId: '1:abc',
  authLoginUrl: 'https://canvas.test/api/lti/authorize_redirect',
  tokenUrl: 'https://canvas.test/login/oauth2/token',
  keysetUrl: 'https://canvas.test/api/lti/security/jwks',
};

const ok = (body: unknown) =>
  Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);

function show(platforms: (typeof platform)[] = [], siteUrl = 'https://afct.test') {
  const fetchMock = vi.fn().mockReturnValue(ok({ platforms }));
  vi.stubGlobal('fetch', fetchMock);
  render(<LtiTab siteUrl={siteUrl} />);
  return fetchMock;
}

/**
 * The two halves use some of the same field names, so everything is scoped to its own section
 * rather than matched across the whole tab.
 */
const section = (heading: string) =>
  within(screen.getByRole('heading', { name: heading }).parentElement as HTMLElement);

/** Fills the add form with something the shared schema accepts. */
async function fillForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /Add an LMS/ }));
  const form = section('Add an LMS');
  const type = async (label: RegExp, value: string) => user.type(form.getByLabelText(label), value);
  await type(/^Name/, 'Canvas');
  await type(/Platform issuer/, 'https://canvas.test');
  await type(/Client ID/, '10000000000001');
  await type(/Deployment ID/, '1:abc');
  await type(/Authorization URL/, 'https://canvas.test/auth');
  await type(/Token URL/, 'https://canvas.test/token');
  await type(/Public keyset URL/, 'https://canvas.test/jwks');
}

beforeEach(() => {
  vi.clearAllMocks();
  resetToastMock();
  vi.unstubAllGlobals();
});

/** The values an administrator has to paste into the LMS. Wrong here means nothing works. */
describe('what AFCT hands over', () => {
  it('builds its URLs from the site address', async () => {
    show([], 'https://afct.example.edu');

    await screen.findByRole('heading', { name: 'Give these to your LMS' });
    const give = section('Give these to your LMS');
    expect(give.getByLabelText(/Target link URI/)).toHaveValue(
      'https://afct.example.edu/api/lti/launch',
    );
    expect(give.getByLabelText(/Login initiation URL/)).toHaveValue(
      'https://afct.example.edu/api/lti/login',
    );
    expect(give.getByLabelText(/Public keyset URL/)).toHaveValue(
      'https://afct.example.edu/api/lti/jwks',
    );
  });

  // A trailing slash in the configured site URL would otherwise produce a double slash.
  it('does not double the slash when the site URL ends in one', async () => {
    show([], 'https://afct.test/');

    await screen.findByRole('heading', { name: 'Give these to your LMS' });
    expect(section('Give these to your LMS').getByLabelText(/Target link URI/)).toHaveValue(
      'https://afct.test/api/lti/launch',
    );
  });
});

describe('the registered list', () => {
  it('says plainly when nothing is registered yet', async () => {
    show([]);

    expect(await screen.findByText(/No LMS is registered/)).toBeInTheDocument();
  });

  it('shows a registration with the values that identify it', async () => {
    show([platform]);

    expect(await screen.findByText('Canvas')).toBeInTheDocument();
    expect(screen.getByText('https://canvas.test')).toBeInTheDocument();
    expect(screen.getByText(/Client 10000000000001, deployment 1:abc/)).toBeInTheDocument();
  });

  it('reports a failed load rather than showing an empty list as fact', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    render(<LtiTab siteUrl="https://afct.test" />);

    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
  });
});

describe('registering one', () => {
  it('checks the values before sending them', async () => {
    show([]);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /Add an LMS/ }));
    await user.type(section('Add an LMS').getByLabelText(/^Name/), 'Canvas');
    await user.click(screen.getByRole('button', { name: /^Register$/ }));

    // Rejected next to the fields, without a round trip.
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('posts a complete registration and reloads the list', async () => {
    const fetchMock = show([]);
    const user = userEvent.setup();

    await screen.findByRole('button', { name: /Add an LMS/ });
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: /^Register$/ }));

    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('LMS registered'));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/lti/platforms',
      expect.objectContaining({ method: 'POST' }),
    );
    // Loaded once at mount, posted, then reloaded from the server.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  /**
   * The route refuses a duplicate triple, which is the mistake an administrator actually makes
   * when a second course is added. Its wording is the useful one.
   */
  it('shows the reason the server refused', async () => {
    const fetchMock = vi.fn().mockReturnValue(ok({ platforms: [] }));
    fetchMock.mockReturnValueOnce(ok({ platforms: [] })).mockReturnValueOnce(
      Promise.resolve({
        ok: false,
        status: 409,
        json: () => Promise.resolve({ error: 'That LMS is already registered.' }),
      } as Response),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<LtiTab siteUrl="https://afct.test" />);
    const user = userEvent.setup();

    await screen.findByRole('button', { name: /Add an LMS/ });
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: /^Register$/ }));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith('That LMS is already registered.'),
    );
  });
});

/** Removing a registration stops every launch from that LMS, so it asks first. */
describe('removing one', () => {
  it('asks before removing', async () => {
    show([platform]);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Remove Canvas' }));

    expect(await screen.findByText(/Remove this registration\?/)).toBeInTheDocument();
    // Nothing sent yet: the list load is still the only call.
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('deletes only once confirmed', async () => {
    const fetchMock = show([platform]);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Remove Canvas' }));
    await user.click(await screen.findByRole('button', { name: /^Remove$/ }));

    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('Registration removed'));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/lti/platforms/p-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});
