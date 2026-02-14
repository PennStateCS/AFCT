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
        const Tag = element as keyof JSX.IntrinsicElements;
        return ({ children, ...props }: { children?: React.ReactNode }) =>
          React.createElement(Tag, props, children);
      },
    },
  );

  return {
    motion: motionProxy,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

vi.mock('@radix-ui/react-popover', () => ({
  Root: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Trigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Content: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Portal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Arrow: () => null,
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

const createJsonResponse = <T,>(data: T, ok = true) =>
  Promise.resolve({
    ok,
    json: async () => data,
  } as Response);

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
  const toggle = getButtonByType(label, 'button');
  await user.click(toggle);
};

const getSubmitButton = (label: string | RegExp) => getButtonByType(label, 'submit');

beforeAll(() => {
  (globalThis as typeof globalThis & { React?: typeof React }).React = React;
  originalFetch = globalThis.fetch;
  originalLocation = window.location;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: originalLocation,
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  setSearchParams();
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  configureLocation();
});

describe('LoginPage', () => {
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
      expect(signInMock).toHaveBeenCalledWith('credentials', {
        email: 'admin@example.com',
        password: 'StrongPass1!',
        redirect: false,
      }),
    );

    await waitFor(() => expect(window.location.href).toBe('/dashboard'));
  });

  it('requires login inputs before submitting', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    expect(getSubmitButton(LOGIN_SUBMIT_LABEL)).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'not-an-email' },
    });
    await waitFor(() => expect(getSubmitButton(LOGIN_SUBMIT_LABEL)).toBeDisabled());

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

    await user.click(getSubmitButton(LOGIN_SUBMIT_LABEL));

    await waitFor(() =>
      expect(showToastErrorMock).toHaveBeenCalledWith('Invalid email or password.'),
    );
    expect(screen.getByText('Email or password is incorrect.')).toBeInTheDocument();
    await waitFor(() => expect(signInMock).toHaveBeenCalled());
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
    expect(fetchMock).not.toHaveBeenCalled();
    expect(signInMock).not.toHaveBeenCalled();
  });

  it('completes signup flow and logs the user in', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    await switchMode(user, /Sign up/i);

    fetchMock.mockImplementation(() => createJsonResponse({}, true));

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

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [signupUrl, signupInit] = fetchMock.mock.calls[0];
    expect(signupUrl).toBe('/api/auth/signup');
    expect(signupInit).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(JSON.parse((signupInit as RequestInit).body as string)).toEqual({
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'grace@example.com',
      password: 'StrongPass1!',
      role: 'STUDENT',
    });

    await waitFor(() =>
      expect(signInMock).toHaveBeenCalledWith('credentials', {
        email: 'grace@example.com',
        password: 'StrongPass1!',
        redirect: false,
      }),
    );
    await waitFor(() => expect(window.location.href).toBe('/dashboard'));
    expect(showToastErrorMock).not.toHaveBeenCalled();
  });

  it('handles signup API failure gracefully', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    await switchMode(user, /Sign up/i);

    fetchMock.mockImplementation(() => createJsonResponse({}, false));

    fireEvent.change(screen.getByLabelText('First Name'), { target: { value: 'Linus' } });
    fireEvent.change(screen.getByLabelText('Last Name'), { target: { value: 'Torvalds' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'linus@example.com' } });
    fireEvent.change(screen.getByLabelText(/^Password$/), { target: { value: 'StrongPass1!' } });
    fireEvent.change(screen.getByLabelText('Confirm Password'), {
      target: { value: 'StrongPass1!' },
    });

    await user.click(getSubmitButton(SIGNUP_SUBMIT_LABEL));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(showToastErrorMock).toHaveBeenCalledWith('Signup failed.'));
    expect(signInMock).not.toHaveBeenCalled();
  });
});
