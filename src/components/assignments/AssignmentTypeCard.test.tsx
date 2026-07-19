/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AssignmentTypeCard } from './AssignmentTypeCard';

const { toastSuccessMock, toastErrorMock } = vi.hoisted(() => ({
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));
vi.mock('@/lib/toast', () => ({
  showToast: { success: toastSuccessMock, error: toastErrorMock, warning: vi.fn() },
}));

// Render SelectField as a native select so the group-set choice is queryable.
vi.mock('@/components/ui/SelectField', () => ({
  __esModule: true,
  default: ({
    label,
    options = [],
    value,
    onValueChange,
  }: {
    label: string;
    options?: Array<{ value: string; label: React.ReactNode }>;
    value?: string;
    onValueChange?: (v: string) => void;
  }) => (
    <label>
      {label}
      <select aria-label={label} value={value ?? ''} onChange={(e) => onValueChange?.(e.target.value)}>
        <option value="" />
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  ),
}));

const originalFetch = global.fetch;
const ok = (data: unknown) => ({
  ok: true,
  status: 200,
  json: async () => data,
  text: async () => JSON.stringify(data),
});
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  const u = String(url);
  const method = (init?.method ?? 'GET').toUpperCase();
  if (method === 'PUT' && u.includes('/type')) return ok({ id: 'a1' }) as unknown as Response;
  if (u.includes('/group-sets')) {
    return ok([{ id: 'gs-1', name: 'Project Teams', groupCount: 2 }]) as unknown as Response;
  }
  throw new Error(`Unexpected fetch: ${method} ${u}`);
});

const renderCard = (groupSetId: string | null, courseIsArchived = false) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const onChanged = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <AssignmentTypeCard
        courseId="c1"
        assignmentId="a1"
        groupSetId={groupSetId}
        courseIsArchived={courseIsArchived}
        onChanged={onChanged}
      />
    </QueryClientProvider>,
  );
  return { onChanged };
};

const putCalls = () =>
  fetchMock.mock.calls.filter(
    ([url, init]) =>
      ((init as RequestInit | undefined)?.method ?? 'GET').toUpperCase() === 'PUT' &&
      String(url).includes('/type'),
  );

beforeEach(() => {
  fetchMock.mockClear();
  global.fetch = fetchMock as unknown as typeof fetch;
  toastSuccessMock.mockReset();
  toastErrorMock.mockReset();
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe('AssignmentTypeCard', () => {
  it('shows Individual selected and Change disabled with no change', () => {
    renderCard(null);
    expect(screen.getByRole('radio', { name: /Individual/ })).toBeChecked();
    expect(screen.getByRole('button', { name: /change type/i })).toBeDisabled();
  });

  it('requires a group set before an individual -> group change can be saved', async () => {
    const user = userEvent.setup();
    renderCard(null);

    await user.click(screen.getByRole('radio', { name: /^Group/ }));
    // No set chosen yet -> still disabled.
    expect(screen.getByRole('button', { name: /change type/i })).toBeDisabled();

    await user.selectOptions(await screen.findByLabelText('Group set'), 'gs-1');
    expect(screen.getByRole('button', { name: /change type/i })).toBeEnabled();
  });

  it('confirms, then PUTs the type change to the group set', async () => {
    const user = userEvent.setup();
    const { onChanged } = renderCard(null);

    await user.click(screen.getByRole('radio', { name: /^Group/ }));
    await user.selectOptions(await screen.findByLabelText('Group set'), 'gs-1');
    await user.click(screen.getByRole('button', { name: /change type/i }));

    // Confirmation appears; nothing sent yet.
    expect(putCalls()).toHaveLength(0);
    await user.click(await screen.findByRole('button', { name: /^Change type$/i }));

    await waitFor(() => expect(putCalls()).toHaveLength(1));
    expect(JSON.parse((putCalls()[0][1] as RequestInit).body as string)).toEqual({
      groupSetId: 'gs-1',
    });
    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalled());
    expect(onChanged).toHaveBeenCalled();
  });

  it('changes a group assignment back to individual (groupSetId null)', async () => {
    const user = userEvent.setup();
    renderCard('gs-1');

    await user.click(screen.getByRole('radio', { name: /Individual/ }));
    await user.click(screen.getByRole('button', { name: /change type/i }));
    await user.click(await screen.findByRole('button', { name: /^Change type$/i }));

    await waitFor(() => expect(putCalls()).toHaveLength(1));
    expect(JSON.parse((putCalls()[0][1] as RequestInit).body as string)).toEqual({
      groupSetId: null,
    });
  });

  it('disables Change when the course is archived', () => {
    renderCard(null, true);
    expect(screen.getByRole('button', { name: /change type/i })).toBeDisabled();
  });
});
