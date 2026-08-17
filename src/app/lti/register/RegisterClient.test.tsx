/** @vitest-environment jsdom */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RegisterClient from './RegisterClient';

/**
 * The screen an LMS frames while registering itself.
 *
 * Two things here are not obvious from looking at it. Nothing happens until somebody presses the
 * button, which is what stops a URL somebody found from registering anything; and the platform
 * is told the flow is over by a postMessage, which is the only way its frame ever closes.
 */

const props = {
  token: 'rt-123',
  openidConfiguration: 'https://lms.school.edu/.well-known/openid-configuration',
  registrationToken: 'platform-token',
  platformHost: 'lms.school.edu',
};

const answered = (status: number, body: unknown) =>
  vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body } as Response);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it('names the LMS asking, and does nothing at all until it is agreed to', async () => {
  const fetchMock = answered(201, {});
  vi.stubGlobal('fetch', fetchMock);

  render(<RegisterClient {...props} />);

  expect(screen.getByText('lms.school.edu')).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
});

describe('registering', () => {
  it('sends what the LMS supplied, unchanged', async () => {
    const user = userEvent.setup();
    const fetchMock = answered(201, {
      platform: {
        name: 'Canvas',
        issuer: 'https://lms.school.edu',
        clientId: 'c',
        deploymentId: 'd',
      },
      notes: [],
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<RegisterClient {...props} />);
    await user.click(screen.getByRole('button', { name: 'Register' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({
      token: 'rt-123',
      openidConfiguration: props.openidConfiguration,
      registrationToken: 'platform-token',
    });
  });

  it('reports what was registered, and tells the LMS the flow is finished', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      answered(201, {
        platform: {
          name: 'Canvas (lms.school.edu)',
          issuer: 'https://lms.school.edu',
          clientId: 'client-7',
          deploymentId: 'deploy-7',
        },
        notes: ['Brightspace also needs its OAuth2 Audience.'],
      }),
    );
    const postMessage = vi.fn();
    vi.stubGlobal('parent', { postMessage });

    render(<RegisterClient {...props} />);
    await user.click(screen.getByRole('button', { name: 'Register' }));

    expect(await screen.findByText(/Canvas \(lms.school.edu\) is registered/)).toBeInTheDocument();
    expect(screen.getByText('client-7')).toBeInTheDocument();
    expect(screen.getByText(/OAuth2 Audience/)).toBeInTheDocument();
    // Without this the LMS leaves its frame open on a finished registration, and the
    // administrator is left guessing whether it worked.
    expect(postMessage).toHaveBeenCalledWith({ subject: 'org.imsglobal.lti.close' }, '*');
  });

  it("shows the server's own explanation, which says what to do next", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      answered(400, { error: 'This registration link has expired or has already been used.' }),
    );
    const postMessage = vi.fn();
    vi.stubGlobal('parent', { postMessage });

    render(<RegisterClient {...props} />);
    await user.click(screen.getByRole('button', { name: 'Register' }));

    expect(await screen.findByRole('status')).toHaveTextContent(/expired or has already been used/);
    // The frame stays open on a failure, because the message in it is the only place the reason
    // is written down for the person looking at it.
    expect(postMessage).not.toHaveBeenCalled();
  });
});
