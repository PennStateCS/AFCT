/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import LoginPage from './page';

const { signInMock, toastErrorMock, toastSuccessMock, searchState } = vi.hoisted(() => ({
  signInMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  searchState: { current: new URLSearchParams() },
}));

vi.mock('next-auth/react', () => ({
  signIn: signInMock,
}));

vi.mock('sonner', () => ({
  toast: {
    error: toastErrorMock,
    success: toastSuccessMock,
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
  }: {
    label: string;
    id?: string;
    name: string;
    value?: string;
    setValue?: (val: string) => void;
    type?: string;
    onBlur?: (event: React.FocusEvent<HTMLInputElement>) => void;
  }) => {
    const inputId = id ?? name;
    return (
      <label htmlFor={inputId}>
        {label}
        <input
          id={inputId}
          name={name}
          type={type}
          value={value}
          onChange={(event) => setValue?.(event.target.value)}
          onBlur={onBlur}
        />
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

const getButtonByType = (label: string | RegExp, type: 'submit' | 'button') => {
  const buttons = screen.getAllByRole('button', { name: label });
  const target = buttons.find((btn) => btn.getAttribute('type') === type);
  if (!target) {
    throw new Error(`Button with label ${label.toString()} and type ${type} not found`);
  }
  return target;
};

const switchMode = async (user: ReturnType<typeof userEvent.setup>, label: string) => {
  const toggle = getButtonByType(label, 'button');
  await user.click(toggle);
};

const getSubmitButton = (label: string) => getButtonByType(label, 'submit');

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
    await waitFor(() => expect(getSubmitButton('Login')).not.toBeDisabled());
    await user.click(getSubmitButton('Login'));

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

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'incomplete@example.com' },
    });
    await waitFor(() => expect(getSubmitButton('Login')).not.toBeDisabled());
    await user.click(getSubmitButton('Login'));

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('Please fill in both fields.'));
    expect(signInMock).not.toHaveBeenCalled();
  });

  it('shows toast for invalid credentials via search params', async () => {
    setSearchParams({ error: 'CredentialsSignin' });
    render(<LoginPage />);

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('Invalid email or password.'));
  });

  it('prefills login form using quick role buttons', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.click(screen.getByRole('button', { name: 'Admin' }));

    expect(screen.getByLabelText(/email/i)).toHaveValue('admin@example.com');
    expect(screen.getByLabelText(/^password$/i)).toHaveValue('password123');
  });

  it("prevents signup when passwords don't match", async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    await switchMode(user, 'Sign Up');

    fetchMock.mockImplementation(() => createJsonResponse({ exists: false }));

    fireEvent.change(screen.getByLabelText('First Name'), { target: { value: 'Ada' } });
    fireEvent.change(screen.getByLabelText('Last Name'), { target: { value: 'Lovelace' } });
    const signupEmail = screen.getByLabelText('Email');
    fireEvent.change(signupEmail, { target: { value: 'ada@example.com' } });
    fireEvent.change(screen.getByLabelText(/^Password$/), { target: { value: 'StrongPass1!' } });
    fireEvent.change(screen.getByLabelText('Confirm Password'), {
      target: { value: 'Mismatch1!' },
    });

    await waitFor(() => expect(getSubmitButton('Sign Up')).not.toBeDisabled());
    await user.click(getSubmitButton('Sign Up'));

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith("Passwords don't match."));
    expect(signInMock).not.toHaveBeenCalled();
  });

  it('completes signup flow and logs the user in', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    await switchMode(user, 'Sign Up');

    fetchMock.mockImplementation((url, options) => {
      if (typeof url === 'string' && url.includes('/api/auth/check-email')) {
        return createJsonResponse({ exists: false });
      }
      if (url === '/api/auth/signup') {
        return createJsonResponse({});
      }
      throw new Error(`Unhandled fetch call: ${url}`);
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

    await waitFor(() => expect(getSubmitButton('Sign Up')).not.toBeDisabled());
    await user.click(getSubmitButton('Sign Up'));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/auth/signup', expect.any(Object)),
    );
    await waitFor(() =>
      expect(toastSuccessMock).toHaveBeenCalledWith('Account created! Logging you in...'),
    );
    await waitFor(() =>
      expect(signInMock).toHaveBeenCalledWith('credentials', {
        email: 'grace@example.com',
        password: 'StrongPass1!',
        redirect: false,
      }),
    );
    await waitFor(() => expect(window.location.href).toBe('/dashboard'));
  });
});
