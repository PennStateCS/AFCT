/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Assignment } from '@prisma/client';

import { AssignmentSettingsCard } from './AssignmentSettingsCard';

const { toastSuccessMock, toastErrorMock, toastWarningMock } = vi.hoisted(() => ({
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastWarningMock: vi.fn(),
}));
vi.mock('@/lib/toast', () => ({
  showToast: { success: toastSuccessMock, error: toastErrorMock, warning: toastWarningMock },
}));

// Drive the allow-late / late-policy switches by role.
vi.mock('@/components/ui/switch', () => ({
  Switch: ({
    id,
    checked,
    onCheckedChange,
  }: {
    id?: string;
    checked?: boolean;
    onCheckedChange?: (next: boolean) => void;
  }) => (
    <input
      type="checkbox"
      role="switch"
      id={id}
      checked={!!checked}
      onChange={(e) => onCheckedChange?.(e.target.checked)}
    />
  ),
}));

// The audience selector is Radix-heavy and covered by its own test; render a light stub
// that still surfaces its "Assign to:" label so this file stays fast under parallel load.
vi.mock('@/components/assignments/AudienceSelect', () => ({
  AudienceSelect: ({ label }: { label: string }) => (
    <fieldset>
      <legend>{label}</legend>
    </fieldset>
  ),
}));

// The late-policy Radix Select -> a native <select> so it's driveable in jsdom.
vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (v: string) => void;
    children: React.ReactNode;
  }) => (
    <select value={value} onChange={(e) => onValueChange?.(e.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

// The "Add override" picker: render each candidate as a button.
vi.mock('@/components/ui/SearchableSelect', () => ({
  SearchableSelect: ({
    label,
    items,
    onSelect,
  }: {
    label: string;
    items: Array<{ id: string; label: string }>;
    onSelect: (id: string) => void;
  }) => (
    <fieldset>
      <legend>{label}</legend>
      {items.map((item) => (
        <button key={item.id} type="button" onClick={() => onSelect(item.id)}>
          {item.label}
        </button>
      ))}
    </fieldset>
  ),
}));

const baseAssignment = {
  id: 'a1',
  title: 'Original',
  description: 'Desc',
  dueDate: new Date('2026-09-01T23:59:00Z'),
  unlockAt: null,
  assignedToEveryone: true,
  isPublished: false,
  allowLateSubmissions: false,
  lateCutoff: null,
  groupSetId: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  courseId: 'c1',
} as unknown as Assignment;

const students = [
  { id: 's1', firstName: 'Alice', lastName: 'Anderson', email: 'alice@x.edu' },
  { id: 's2', firstName: 'Bob', lastName: 'Baker', email: 'bob@x.edu' },
];

let overridesData: unknown[] = [];
let assigneesData: unknown[] = [];

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
  if (method === 'PUT' && u.includes('/assignees')) return ok({ id: 'a1' }) as unknown as Response;
  if (method === 'PUT' && u.includes('/assignments/a1')) return ok(baseAssignment) as unknown as Response;
  if (u.includes('/overrides')) return ok(overridesData) as unknown as Response; // GET list + POST/PATCH/DELETE
  if (u.includes('/assignees')) return ok(assigneesData) as unknown as Response;
  if (u.includes('/students')) return ok(students) as unknown as Response;
  if (u.includes('/group-sets')) return ok([]) as unknown as Response;
  throw new Error(`Unexpected fetch: ${method} ${u}`);
});

const renderCard = (props: Partial<React.ComponentProps<typeof AssignmentSettingsCard>> = {}) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const onSaved = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <AssignmentSettingsCard
        courseId="c1"
        assignment={baseAssignment}
        timeZone="UTC"
        courseIsArchived={false}
        onSaved={onSaved}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { onSaved };
};

const callsFor = (method: string, includes: string) =>
  fetchMock.mock.calls.filter(([url, init]) => {
    const m = ((init as RequestInit | undefined)?.method ?? 'GET').toUpperCase();
    return m === method && String(url).includes(includes);
  });
const bodyOf = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string);

beforeEach(() => {
  fetchMock.mockClear();
  overridesData = [];
  assigneesData = [];
  global.fetch = fetchMock as unknown as typeof fetch;
  toastSuccessMock.mockReset();
  toastErrorMock.mockReset();
  toastWarningMock.mockReset();
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe('AssignmentSettingsCard', () => {
  it('shows the wizard audience selector, schedule, and the date-overrides section', async () => {
    renderCard();
    expect(await screen.findByText('Assign to:')).toBeInTheDocument();
    expect(screen.getByLabelText('Due')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /date overrides \(0\)/i })).toBeInTheDocument();
  });

  it('saves the schedule (base PUT) and the audience (assignees PUT)', async () => {
    const user = userEvent.setup();
    const { onSaved } = renderCard();

    const save = await screen.findByRole('button', { name: /save changes/i });
    expect(save).toBeDisabled();

    await user.click(screen.getByRole('switch', { name: /allow late submissions/i }));
    await waitFor(() => expect(save).toBeEnabled());
    await user.click(save);

    await waitFor(() => expect(callsFor('PUT', '/assignments/a1').length).toBeGreaterThan(0));
    const basePut = callsFor('PUT', '/assignments/a1').find((c) => !String(c[0]).includes('/assignees'));
    expect(bodyOf(basePut!)).toMatchObject({ allowLateSubmissions: true });
    await waitFor(() => expect(callsFor('PUT', '/assignees').length).toBe(1));
    expect(bodyOf(callsFor('PUT', '/assignees')[0])).toEqual({ assignedToEveryone: true, assignees: [] });
    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalledWith('Assign To saved'));
    expect(onSaved).toHaveBeenCalled();
  });

  it('adds a date override for a student and POSTs it on save', async () => {
    const user = userEvent.setup();
    renderCard();

    // The picker lists the assigned student (everyone -> all students).
    await user.click(await screen.findByRole('button', { name: 'Alice Anderson' }));
    expect(await screen.findByRole('heading', { name: /date overrides \(1\)/i })).toBeInTheDocument();

    // Give the override a due date (the base "Due" is labelled "Due"; the override one too,
    // so set "Available from" which is unique to the override row).
    fireEvent.change(screen.getByLabelText('Available from'), {
      target: { value: '2026-08-20T10:00' },
    });

    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(callsFor('POST', '/overrides').length).toBe(1));
    expect(bodyOf(callsFor('POST', '/overrides')[0])).toMatchObject({
      userId: 's1',
      unlockAt: '2026-08-20T10:00',
    });
  });

  it('persists every override field (available from, due, late policy, accept until)', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(await screen.findByRole('button', { name: 'Alice Anderson' }));
    await screen.findByRole('heading', { name: /date overrides \(1\)/i });

    // Available from is unique to the override row (the base field is "Available from (optional)").
    fireEvent.change(screen.getByLabelText('Available from'), {
      target: { value: '2026-08-01T09:00' },
    });
    // Two "Due" fields: base schedule (0) and this override (1).
    fireEvent.change(screen.getAllByLabelText('Due')[1], { target: { value: '2026-08-25T23:59' } });
    // Late policy -> allow, which reveals the override's Accept until.
    await user.selectOptions(screen.getByRole('combobox'), 'allow');
    fireEvent.change(await screen.findByLabelText('Accept until (optional)'), {
      target: { value: '2026-08-30T23:59' },
    });

    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(callsFor('POST', '/overrides').length).toBe(1));
    expect(bodyOf(callsFor('POST', '/overrides')[0])).toMatchObject({
      userId: 's1',
      unlockAt: '2026-08-01T09:00',
      dueDate: '2026-08-25T23:59',
      allowLateSubmissions: true,
      lateCutoff: '2026-08-30T23:59',
    });
  });

  it('lists only assigned students in the Add override picker', async () => {
    // A specific-students assignment where only Alice is assigned (Bob is enrolled but not).
    assigneesData = [
      { id: 'as1', targetType: 'STUDENT', userId: 's1', groupId: null, user: students[0] },
    ];
    renderCard({ assignment: { ...baseAssignment, assignedToEveryone: false } });

    // The picker offers Alice (assigned) but not Bob (not assigned).
    expect(await screen.findByRole('button', { name: 'Alice Anderson' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bob Baker' })).toBeNull();
  });

  it('deletes an existing override when it is removed', async () => {
    overridesData = [
      {
        id: 'o1',
        targetType: 'STUDENT',
        userId: 's1',
        groupId: null,
        unlockAt: null,
        dueDate: '2026-09-10T23:59:00Z',
        lateCutoff: null,
        allowLateSubmissions: null,
        user: { firstName: 'Alice', lastName: 'Anderson', email: 'alice@x.edu' },
      },
    ];
    const user = userEvent.setup();
    renderCard();

    await screen.findByRole('button', { name: /edit date override for Alice Anderson/i });
    await user.click(screen.getByRole('button', { name: /remove date override for Alice Anderson/i }));
    expect(screen.getByRole('heading', { name: /date overrides \(0\)/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(callsFor('DELETE', '/overrides/o1').length).toBe(1));
  });

  it('disables Save when the course is archived', async () => {
    renderCard({ courseIsArchived: true });
    await screen.findByRole('button', { name: /save changes/i });
    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled();
  });
});
