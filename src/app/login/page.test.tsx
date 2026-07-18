/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import LoginPage from './page';

const { signInMock, showToastErrorMock, searchState } = vi.hoisted(() => ({
  signInMock: vi.fn(),
  showToastErrorMock: vi.fn(),
  searchState: { current: new URLSearchParams() },
}));

const nowRef = { value: 0 };
const getMockTime = () => nowRef.value;
let performanceNowSpy: ReturnType<typeof vi.spyOn> | null = null;
let originalCaptchaKey: string | undefined;

vi.mock('next-auth/react', () => ({
  signIn: signInMock,
}));

vi.mock('@/lib/toast', () => ({
  showToast: {
    error: showToastErrorMock,
    success: vi.fn(),
  },
}));

vi.mock('@/components/ui/InputGroup', () => ({
  __esModule: true,
  default: ({
    label,
    id,
    name,
    value = '',
    setValue,
    type = 'text',
    onBlur,
    error,
    additionalDescribedBy,
  }: {
    label: string;
    id?: string;
    name: string;
    value?: string;
    setValue?: (val: string) => void;
    type?: string;
    onBlur?: (event: React.FocusEvent<HTMLInputElement>) => void;
    error?: string;
    additionalDescribedBy?: string;
  }) => {
    const inputId = id ?? name;
    const errorId = `${inputId}-error`;
    const describedByTokens = [] as string[];
    if (additionalDescribedBy) describedByTokens.push(additionalDescribedBy);
    if (error) describedByTokens.push(errorId);
    const describedBy = describedByTokens.length ? describedByTokens.join(' ') : undefined;
    return (
      <label htmlFor={inputId}>
        {label}
        <input
          id={inputId}
          name={name}
          type={type}
          value={value}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={describedBy}
          onChange={(event) => setValue?.(event.target.value)}
          onBlur={onBlur}
        />
        {error && (
          <span id={errorId} role="alert">
            {error}
          </span>
        )}
      </label>
    );
  },
}));

const setSearchParams = (entries: Record<string, string> = {}) => {
  const next = new URLSearchParams();
  Object.entries(entries).forEach(([key, value]) => next.set(key, value));
  searchState.current = next;
};

vi.mock('next/navigation', () => ({
  useSearchParams: () => searchState.current,
}));

vi.mock('framer-motion', () => {
  const motionProxy = new Proxy(
    {},
    {
      get: (_, element: string) => {
        const Tag = element as keyof React.JSX.IntrinsicElements;
        return ({ children, ...props }: { children?: React.ReactNode }) =>
          React.createElement(Tag, props, children);
      },
    },
  );

  return {
    motion: motionProxy,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useReducedMotion: () => false,
  };
});

vi.mock('@radix-ui/react-popover', () => ({
  Root: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Trigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Content: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Portal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Arrow: () => null,
}));

vi.mock('@hcaptcha/react-hcaptcha', () => ({
  __esModule: true,
  default: ({ onVerify }: { onVerify?: (token: string) => void }) => (
    <button data-testid="mock-hcaptcha" onClick={() => onVerify?.('mock-token')}>
      MockCaptcha
    </button>
  ),
}));

const fetchMock = vi.fn();
let originalFetch: typeof fetch;
let originalLocation: Location;

const configureLocation = () => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      href: '',
      assign: vi.fn(),
      replace: vi.fn(),
    },
  });
};

const createJsonResponse = <T,>(data: T, status = 200) =>
  Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  } as Response);

const mockPublicSettings = (allowSignup = true) => {
  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    if (String(input).includes('/api/system-settings/public')) {
      return createJsonResponse({ timezone: 'UTC', allowSignup }, 200);
    }

    return createJsonResponse({}, 500);
  });
};

const LOGIN_SUBMIT_LABEL = 'Sign In';
const SIGNUP_SUBMIT_LABEL = 'Create Account';

const getButtonByType = (label: string | RegExp, type: 'submit' | 'button') => {
  const buttons = screen.getAllByRole('button', { name: label });
  const target = buttons.find((btn) => btn.getAttribute('type') === type);
  if (!target) {
    throw new Error(`Button with label ${label.toString()} and type ${type} not found`);
  }
  return target;
};

const switchMode = async (user: ReturnType<typeof userEvent.setup>, label: string | RegExp) => {
  await waitFor(() => {
    expect(screen.queryByRole('button', { name: label })).toBeInTheDocument();
  });
  const toggle = getButtonByType(label, 'button');
  await user.click(toggle);
};

const getSubmitButton = (label: string | RegExp) => getButtonByType(label, 'submit');

beforeAll(() => {
  (globalThis as typeof globalThis & { React?: typeof React }).React = React;
  originalFetch = globalThis.fetch;
  originalLocation = window.location;
  originalCaptchaKey = process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY;
  process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY = 'test-hcaptcha-key';
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    performanceNowSpy = vi.spyOn(performance, 'now').mockImplementation(getMockTime);
  }
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: originalLocation,
  });
  performanceNowSpy?.mockRestore();
  process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY = originalCaptchaKey;
});

beforeEach(() => {
  vi.clearAllMocks();
  setSearchParams();
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  mockPublicSettings(true);
  configureLocation();
  nowRef.value = 0;
});

describe('LoginPage', () => {
  it('hides signup affordances when public settings disable signup', async () => {
    mockPublicSettings(false);

    render(<LoginPage />);

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Sign up/i })).not.toBeInTheDocument();
    });
    expect(screen.queryByText(/Don't have an account\?/i)).not.toBeInTheDocument();
  });

  it('submits login form and redirects on success', async () => {
    signInMock.mockResolvedValueOnce({ error: null });
    const user = userEvent.setup();

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'admin@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: 'StrongPass1!' },
    });
    await waitFor(() => expect(getSubmitButton(LOGIN_SUBMIT_LABEL)).not.toBeDisabled());
    await user.click(getSubmitButton(LOGIN_SUBMIT_LABEL));

    await waitFor(() =>
      expect(signInMock).toHaveBeenCalledWith(
        'credentials',
        expect.objectContaining({
          email: 'admin@example.com',
          password: 'StrongPass1!',
          redirect: false,
          interactionMs: expect.any(Number),
        }),
      ),
    );

    await waitFor(() => expect(window.location.href).toBe('/dashboard'));
  });

  it('honors a same-origin callbackUrl after login (e.g. a join link)', async () => {
    setSearchParams({ callbackUrl: '/dashboard?joinCode=ABCD2345' });
    signInMock.mockResolvedValueOnce({ error: null });
    const user = userEvent.setup();

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'admin@example.com' } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'StrongPass1!' } });
    await waitFor(() => expect(getSubmitButton(LOGIN_SUBMIT_LABEL)).not.toBeDisabled());
    await user.click(getSubmitButton(LOGIN_SUBMIT_LABEL));

    await waitFor(() => expect(window.location.href).toBe('/dashboard?joinCode=ABCD2345'));
  });

  it('ignores an off-site callbackUrl and falls back to the dashboard', async () => {
    setSearchParams({ callbackUrl: 'https://evil.example.com' });
    signInMock.mockResolvedValueOnce({ error: null });
    const user = userEvent.setup();

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'admin@example.com' } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'StrongPass1!' } });
    await waitFor(() => expect(getSubmitButton(LOGIN_SUBMIT_LABEL)).not.toBeDisabled());
    await user.click(getSubmitButton(LOGIN_SUBMIT_LABEL));

    await waitFor(() => expect(window.location.href).toBe('/dashboard'));
  });

  it('keeps the submit button enabled and surfaces field errors on submit', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    // The button is no longer hard-disabled before valid input — even a malformed
    // email leaves it clickable so the user can submit and see the error.
    expect(getSubmitButton(LOGIN_SUBMIT_LABEL)).not.toBeDisabled();
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'not-an-email' } });
    await waitFor(() => expect(getSubmitButton(LOGIN_SUBMIT_LABEL)).not.toBeDisabled());

    // Valid email but missing password: submit runs, surfaces the error, and does
    // not attempt to authenticate.
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'incomplete@example.com' },
    });
    await waitFor(() => expect(getSubmitButton(LOGIN_SUBMIT_LABEL)).not.toBeDisabled());
    await user.click(getSubmitButton(LOGIN_SUBMIT_LABEL));

    await waitFor(() =>
      expect(showToastErrorMock).toHaveBeenCalledWith('Please correct the highlighted fields.'),
    );
    expect(screen.getByText('Password is required.')).toBeInTheDocument();
    expect(signInMock).not.toHaveBeenCalled();
  });

  it('shows toast for invalid credentials via search params', async () => {
    setSearchParams({ error: 'CredentialsSignin' });
    render(<LoginPage />);

    await waitFor(() =>
      expect(showToastErrorMock).toHaveBeenCalledWith('Invalid email or password.'),
    );
  });

  it('shows toast for rate limited search param', async () => {
    setSearchParams({ error: 'RateLimitExceeded' });
    render(<LoginPage />);

    await waitFor(() =>
      expect(showToastErrorMock).toHaveBeenCalledWith(
        'Too many attempts. Please wait before trying again.',
      ),
    );
  });

  it('shows toast for bot challenge search param', async () => {
    setSearchParams({ error: 'BotChallengeRequired' });
    render(<LoginPage />);

    await waitFor(() =>
      expect(showToastErrorMock).toHaveBeenCalledWith(
        'Unusual activity detected. Complete the security check below to continue.',
      ),
    );
  });

  it('prefills login form using quick role buttons', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.click(screen.getByRole('button', { name: 'Admin' }));

    expect(screen.getByLabelText(/email/i)).toHaveValue('admin@example.com');
    expect(screen.getByLabelText(/^password$/i)).toHaveValue('password123');
    expect(getSubmitButton(LOGIN_SUBMIT_LABEL)).not.toBeDisabled();
  });

  it('shows field error when NextAuth rejects credentials', async () => {
    const user = userEvent.setup();
    signInMock.mockResolvedValueOnce({ error: 'CredentialsSignin' });

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'admin@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: 'WrongPass1!' },
    });

    await waitFor(() => expect(getSubmitButton(LOGIN_SUBMIT_LABEL)).not.toBeDisabled());

    await user.click(getSubmitButton(LOGIN_SUBMIT_LABEL));

    await waitFor(() =>
      expect(showToastErrorMock).toHaveBeenCalledWith('Invalid email or password.'),
    );
    expect(screen.getByText('Email or password is incorrect.')).toBeInTheDocument();
    await waitFor(() => expect(signInMock).toHaveBeenCalled());
  });

  it('surfaces rate limit errors from signIn', async () => {
    const user = userEvent.setup();
    signInMock.mockResolvedValueOnce({ error: 'RateLimitExceeded' });

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'admin@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: 'StrongPass1!' },
    });

    await waitFor(() => expect(getSubmitButton(LOGIN_SUBMIT_LABEL)).not.toBeDisabled());

    await user.click(getSubmitButton(LOGIN_SUBMIT_LABEL));

    await waitFor(() =>
      expect(showToastErrorMock).toHaveBeenCalledWith(
        'Too many login attempts. Please wait a few minutes and try again.',
      ),
    );
    expect(signInMock).toHaveBeenCalled();
  });

  it('surfaces bot challenge errors from signIn', async () => {
    const user = userEvent.setup();
    signInMock.mockResolvedValueOnce({ error: 'BotChallengeRequired' });

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'admin@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: 'StrongPass1!' },
    });

    await waitFor(() => expect(getSubmitButton(LOGIN_SUBMIT_LABEL)).not.toBeDisabled());

    await user.click(getSubmitButton(LOGIN_SUBMIT_LABEL));

    await waitFor(() =>
      expect(showToastErrorMock).toHaveBeenCalledWith(
        'Unusual activity detected. Complete the security check below to continue.',
      ),
    );
    expect(signInMock).toHaveBeenCalled();
    expect(screen.getAllByTestId('mock-hcaptcha').length).toBeGreaterThanOrEqual(1);
  });

  it('tells the user to wait when a bot challenge fires but no captcha is configured', async () => {
    const user = userEvent.setup();
    const savedKey = process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY;
    delete process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY;
    try {
      signInMock.mockResolvedValueOnce({ error: 'BotChallengeRequired' });

      render(<LoginPage />);

      fireEvent.change(screen.getByLabelText(/email/i), {
        target: { value: 'admin@example.com' },
      });
      fireEvent.change(screen.getByLabelText(/^password$/i), {
        target: { value: 'StrongPass1!' },
      });

      await waitFor(() => expect(getSubmitButton(LOGIN_SUBMIT_LABEL)).not.toBeDisabled());

      await user.click(getSubmitButton(LOGIN_SUBMIT_LABEL));

      await waitFor(() =>
        expect(showToastErrorMock).toHaveBeenCalledWith(
          'Too many attempts. Please wait a moment before trying again.',
        ),
      );
      // No captcha configured, so no widget is shown; the cooldown alone throttles.
      expect(screen.queryByTestId('mock-hcaptcha')).toBeNull();
    } finally {
      if (savedKey === undefined) delete process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY;
      else process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY = savedKey;
    }
  });

  it("prevents signup when passwords don't match", async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    await switchMode(user, /Sign up/i);

    fireEvent.change(screen.getByLabelText('First Name'), { target: { value: 'Ada' } });
    fireEvent.change(screen.getByLabelText('Last Name'), { target: { value: 'Lovelace' } });
    const signupEmail = screen.getByLabelText('Email');
    fireEvent.change(signupEmail, { target: { value: 'ada@example.com' } });
    fireEvent.change(screen.getByLabelText(/^Password$/), { target: { value: 'StrongPass1!' } });
    fireEvent.change(screen.getByLabelText('Confirm Password'), {
      target: { value: 'Mismatch1!' },
    });

    await user.click(getSubmitButton(SIGNUP_SUBMIT_LABEL));

    await waitFor(() =>
      expect(showToastErrorMock).toHaveBeenCalledWith('Please correct the highlighted fields.'),
    );
    expect(screen.getByText("Passwords don't match.")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/auth/signup'))).toBe(
      false,
    );
    expect(signInMock).not.toHaveBeenCalled();
  });

  it('completes signup flow and logs the user in', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    await switchMode(user, /Sign up/i);

    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/system-settings/public')) {
        return createJsonResponse({ timezone: 'UTC', allowSignup: true }, 200);
      }
      if (url.includes('/api/auth/signup')) {
        return createJsonResponse({}, 200);
      }
      return createJsonResponse({}, 500);
    });

    fireEvent.change(screen.getByLabelText('First Name'), { target: { value: 'Grace' } });
    fireEvent.change(screen.getByLabelText('Last Name'), { target: { value: 'Hopper' } });
    const emailField = screen.getByLabelText('Email');
    fireEvent.change(emailField, { target: { value: 'grace@example.com' } });
    fireEvent.change(screen.getByLabelText(/^Password$/), { target: { value: 'StrongPass1!' } });
    fireEvent.change(screen.getByLabelText('Confirm Password'), {
      target: { value: 'StrongPass1!' },
    });

    signInMock.mockResolvedValue({ error: null });

    await user.click(getSubmitButton(SIGNUP_SUBMIT_LABEL));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/auth/signup'))).toBe(
        true,
      ),
    );
    const signupCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes('/api/auth/signup'),
    );
    expect(signupCall).toBeDefined();
    const [signupUrl, signupInit] = signupCall as [RequestInfo | URL, RequestInit | undefined];
    expect(signupUrl).toBe('/api/auth/signup');
    expect(signupInit).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(JSON.parse((signupInit as RequestInit).body as string)).toEqual(
      expect.objectContaining({
        firstName: 'Grace',
        lastName: 'Hopper',
        email: 'grace@example.com',
        password: 'StrongPass1!',
        role: 'STUDENT',
        interactionMs: expect.any(Number),
      }),
    );

    await waitFor(() =>
      expect(signInMock).toHaveBeenCalledWith(
        'credentials',
        expect.objectContaining({
          email: 'grace@example.com',
          password: 'StrongPass1!',
          redirect: false,
          interactionMs: expect.any(Number),
        }),
      ),
    );
    await waitFor(() => expect(window.location.href).toBe('/dashboard'));
    expect(showToastErrorMock).not.toHaveBeenCalled();
  });

  it('handles signup API failure gracefully', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    await switchMode(user, /Sign up/i);

    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/system-settings/public')) {
        return createJsonResponse({ timezone: 'UTC', allowSignup: true }, 200);
      }
      if (url.includes('/api/auth/signup')) {
        return createJsonResponse({}, 500);
      }
      return createJsonResponse({}, 500);
    });

    fireEvent.change(screen.getByLabelText('First Name'), { target: { value: 'Linus' } });
    fireEvent.change(screen.getByLabelText('Last Name'), { target: { value: 'Torvalds' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'linus@example.com' } });
    fireEvent.change(screen.getByLabelText(/^Password$/), { target: { value: 'StrongPass1!' } });
    fireEvent.change(screen.getByLabelText('Confirm Password'), {
      target: { value: 'StrongPass1!' },
    });

    await user.click(getSubmitButton(SIGNUP_SUBMIT_LABEL));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/auth/signup'))).toBe(
        true,
      ),
    );
    await waitFor(() =>
      expect(showToastErrorMock).toHaveBeenCalledWith('Signup failed. Please try again.'),
    );
    expect(signInMock).not.toHaveBeenCalled();
  });

  it('shows the server reason and pins it to the email field when the email is already registered (409)', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    await switchMode(user, /Sign up/i);
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/system-settings/public')) {
        return createJsonResponse({ timezone: 'UTC', allowSignup: true }, 200);
      }
      if (url.includes('/api/auth/signup')) {
        return createJsonResponse({ error: 'Email already registered.' }, 409);
      }
      return createJsonResponse({}, 500);
    });

    fireEvent.change(screen.getByLabelText('First Name'), { target: { value: 'Linus' } });
    fireEvent.change(screen.getByLabelText('Last Name'), { target: { value: 'Torvalds' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'linus@example.com' } });
    fireEvent.change(screen.getByLabelText(/^Password$/), { target: { value: 'StrongPass1!' } });
    fireEvent.change(screen.getByLabelText('Confirm Password'), {
      target: { value: 'StrongPass1!' },
    });

    await user.click(getSubmitButton(SIGNUP_SUBMIT_LABEL));

    await waitFor(() =>
      expect(showToastErrorMock).toHaveBeenCalledWith('Email already registered.'),
    );
    // stays on the signup form, does not bounce to login
    expect(screen.getByLabelText('Confirm Password')).toBeInTheDocument();
    expect(signInMock).not.toHaveBeenCalled();
  });

  it('shows the domain-not-allowed reason without treating a 403 as "signups disabled"', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    await switchMode(user, /Sign up/i);
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/system-settings/public')) {
        return createJsonResponse({ timezone: 'UTC', allowSignup: true }, 200);
      }
      if (url.includes('/api/auth/signup')) {
        return createJsonResponse(
          { error: 'Email domain not allowed. Allowed domains: psu.edu' },
          403,
        );
      }
      return createJsonResponse({}, 500);
    });

    fireEvent.change(screen.getByLabelText('First Name'), { target: { value: 'Linus' } });
    fireEvent.change(screen.getByLabelText('Last Name'), { target: { value: 'Torvalds' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'linus@gmail.com' } });
    fireEvent.change(screen.getByLabelText(/^Password$/), { target: { value: 'StrongPass1!' } });
    fireEvent.change(screen.getByLabelText('Confirm Password'), {
      target: { value: 'StrongPass1!' },
    });

    await user.click(getSubmitButton(SIGNUP_SUBMIT_LABEL));

    await waitFor(() =>
      expect(showToastErrorMock).toHaveBeenCalledWith(
        'Email domain not allowed. Allowed domains: psu.edu',
      ),
    );
    // must NOT have been kicked to the login form
    expect(screen.getByLabelText('Confirm Password')).toBeInTheDocument();
  });

  it('shows slowdown toast when signup route responds with 428', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    await switchMode(user, /Sign up/i);
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/system-settings/public')) {
        return createJsonResponse({ timezone: 'UTC', allowSignup: true }, 200);
      }
      if (url.includes('/api/auth/signup')) {
        return createJsonResponse({}, 428);
      }
      return createJsonResponse({}, 500);
    });

    fireEvent.change(screen.getByLabelText('First Name'), { target: { value: 'Linus' } });
    fireEvent.change(screen.getByLabelText('Last Name'), { target: { value: 'Torvalds' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'linus@example.com' } });
    fireEvent.change(screen.getByLabelText(/^Password$/), { target: { value: 'StrongPass1!' } });
    fireEvent.change(screen.getByLabelText('Confirm Password'), {
      target: { value: 'StrongPass1!' },
    });

    await user.click(getSubmitButton(SIGNUP_SUBMIT_LABEL));

    await waitFor(() =>
      expect(showToastErrorMock).toHaveBeenCalledWith(
        'Unusual activity detected. Complete the security check below to continue.',
      ),
    );
    expect(signInMock).not.toHaveBeenCalled();
  });

  it('shows rate limit toast when signup route responds with 429', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    await switchMode(user, /Sign up/i);
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/system-settings/public')) {
        return createJsonResponse({ timezone: 'UTC', allowSignup: true }, 200);
      }
      if (url.includes('/api/auth/signup')) {
        return createJsonResponse({}, 429);
      }
      return createJsonResponse({}, 500);
    });

    fireEvent.change(screen.getByLabelText('First Name'), { target: { value: 'Linus' } });
    fireEvent.change(screen.getByLabelText('Last Name'), { target: { value: 'Torvalds' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'linus@example.com' } });
    fireEvent.change(screen.getByLabelText(/^Password$/), { target: { value: 'StrongPass1!' } });
    fireEvent.change(screen.getByLabelText('Confirm Password'), {
      target: { value: 'StrongPass1!' },
    });

    await user.click(getSubmitButton(SIGNUP_SUBMIT_LABEL));

    await waitFor(() =>
      expect(showToastErrorMock).toHaveBeenCalledWith(
        'Too many signup attempts. Please try again later.',
      ),
    );
    expect(signInMock).not.toHaveBeenCalled();
  });

  it('shows disabled message when signup route responds with 403', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    await switchMode(user, /Sign up/i);
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/system-settings/public')) {
        return createJsonResponse({ timezone: 'UTC', allowSignup: true }, 200);
      }
      if (url.includes('/api/auth/signup')) {
        return createJsonResponse({ error: 'Signup is disabled.' }, 403);
      }
      return createJsonResponse({}, 500);
    });

    fireEvent.change(screen.getByLabelText('First Name'), { target: { value: 'Linus' } });
    fireEvent.change(screen.getByLabelText('Last Name'), { target: { value: 'Torvalds' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'linus@example.com' } });
    fireEvent.change(screen.getByLabelText(/^Password$/), { target: { value: 'StrongPass1!' } });
    fireEvent.change(screen.getByLabelText('Confirm Password'), {
      target: { value: 'StrongPass1!' },
    });

    await user.click(getSubmitButton(SIGNUP_SUBMIT_LABEL));

    await waitFor(() => expect(showToastErrorMock).toHaveBeenCalledWith('Signup is disabled.'));
    expect(signInMock).not.toHaveBeenCalled();
  });
});
