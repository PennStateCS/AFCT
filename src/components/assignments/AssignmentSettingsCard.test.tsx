/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
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

// Render the Popover panel inline (always open) so the searchable audience/override
// selectors' controls are queryable without driving the real Radix portal machinery.
vi.mock('@/components/ui/popover', () => {
  const Stub = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;
  return {
    Popover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    PopoverTrigger: Stub,
    PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  };
});

const baseAssignment = {
  id: 'a1',
  title: 'Original',
  description: 'Desc',
  dueDate: new Date('2026-09-01T23:59:00Z'),
  unlockAt: null,
  assignedToEveryone: true,
  isPublished: false,
  isGroup: false,
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

// Per-test override payload the mocked GET /overrides returns.
let overridesData: unknown[] = [];

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
  if (method === 'GET' && u.includes('/students')) return ok(students) as unknown as Response;
  if (method === 'GET' && u.includes('/group-sets')) return ok([]) as unknown as Response;
  if (method === 'GET' && u.includes('/overrides')) return ok(overridesData) as unknown as Response;
  if (u.includes('/overrides')) return ok({ success: true }) as unknown as Response; // POST/PATCH/DELETE
  if (method === 'PUT' && u.includes('/assignments/a1')) {
    return ok({ ...baseAssignment, title: 'New title' }) as unknown as Response;
  }
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

const putBody = () => {
  const put = fetchMock.mock.calls.find(
    ([, init]) => ((init as RequestInit | undefined)?.method ?? 'GET').toUpperCase() === 'PUT',
  );
  return put ? JSON.parse((put[1] as RequestInit).body as string) : null;
};

const callsFor = (method: string, includes: string) =>
  fetchMock.mock.calls.filter(([url, init]) => {
    const m = ((init as RequestInit | undefined)?.method ?? 'GET').toUpperCase();
    return m === method && String(url).includes(includes);
  });

beforeEach(() => {
  fetchMock.mockClear();
  overridesData = [];
  global.fetch = fetchMock as unknown as typeof fetch;
  toastSuccessMock.mockReset();
  toastErrorMock.mockReset();
  toastWarningMock.mockReset();
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe('AssignmentSettingsCard', () => {
  it('disables Save until a field changes, then PUTs the base fields and toasts success', async () => {
    const user = userEvent.setup();
    const { onSaved } = renderCard();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const save = await screen.findByRole('button', { name: /save changes/i });
    expect(save).toBeDisabled();

    // Toggle the base allow-late switch to make the form dirty.
    await user.click(screen.getByRole('switch', { name: /allow late submissions/i }));
    await waitFor(() => expect(save).toBeEnabled());
    await user.click(save);

    await waitFor(() => expect(putBody()).toBeTruthy());
    expect(putBody()).toMatchObject({
      title: 'Original',
      assignedToEveryone: true,
      allowLateSubmissions: true,
      lateCutoff: null,
      isPublished: false,
    });
    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalledWith('Assignment settings saved'));
    expect(onSaved).toHaveBeenCalled();
  });

  it('disables Save when the course is archived', async () => {
    renderCard({ courseIsArchived: true });
    await screen.findByRole('button', { name: /save changes/i });
    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled();
  });

  it('everyone -> limited with an empty audience blocks saving', async () => {
    const user = userEvent.setup();
    renderCard();
    await screen.findByRole('switch', { name: /assign to everyone/i });

    await user.click(screen.getByRole('switch', { name: /assign to everyone/i }));

    expect(
      await screen.findByText(/select at least one student or group before saving/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled();
  });

  it('limited -> everyone shows the all-students summary and preserves overrides', async () => {
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
    renderCard({ assignment: { ...baseAssignment, assignedToEveryone: false } });

    await screen.findByRole('switch', { name: /assign to everyone/i });
    // The date override for Alice is present.
    expect(
      await screen.findByRole('button', { name: /edit date override for Alice/i }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('switch', { name: /assign to everyone/i }));

    expect(await screen.findByText(/assigned to all 2 eligible students/i)).toBeInTheDocument();
    // The override survives the audience change.
    expect(screen.getByRole('button', { name: /edit date override for Alice/i })).toBeInTheDocument();
  });

  it('restores audience selections when toggling everyone off, on, then off again', async () => {
    overridesData = [
      {
        id: 'o1',
        targetType: 'STUDENT',
        userId: 's1',
        groupId: null,
        unlockAt: null,
        dueDate: null,
        lateCutoff: null,
        allowLateSubmissions: null,
        user: { firstName: 'Alice', lastName: 'Anderson', email: 'alice@x.edu' },
      },
    ];
    const user = userEvent.setup();
    renderCard({ assignment: { ...baseAssignment, assignedToEveryone: false } });

    const everyone = await screen.findByRole('switch', { name: /assign to everyone/i });
    // Alice starts selected in the audience.
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: 'Alice Anderson' })).toBeChecked(),
    );

    await user.click(everyone); // -> everyone
    await user.click(everyone); // -> limited again

    // Selection restored, not cleared.
    expect(screen.getByRole('checkbox', { name: 'Alice Anderson' })).toBeChecked();
  });

  it('removing a date override keeps the student in the audience (patches to null)', async () => {
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
    renderCard({ assignment: { ...baseAssignment, assignedToEveryone: false } });

    await screen.findByRole('button', { name: /edit date override for Alice/i });
    // Row shows in the Date overrides list.
    expect(screen.getByRole('heading', { name: /date overrides \(1\)/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /remove date override for Alice/i }));

    // The override row is gone...
    expect(screen.getByRole('heading', { name: /date overrides \(0\)/i })).toBeInTheDocument();
    // ...but Alice is still an audience member.
    expect(screen.getByRole('checkbox', { name: 'Alice Anderson' })).toBeChecked();

    // Saving PATCHes the row to null (keeps membership), does not DELETE it.
    await user.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(callsFor('PUT', '/assignments/a1')).toHaveLength(1));
    await waitFor(() => expect(callsFor('PATCH', '/overrides/o1')).toHaveLength(1));
    expect(callsFor('DELETE', '/overrides/o1')).toHaveLength(0);
  });

  it('expands and collapses a date override row', async () => {
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
    renderCard({ assignment: { ...baseAssignment, assignedToEveryone: false } });

    const trigger = await screen.findByRole('button', { name: /edit date override for Alice/i });
    // Collapsed: no inline "Available from" editor yet.
    expect(screen.queryByLabelText('Available from')).not.toBeInTheDocument();

    await user.click(trigger);
    expect(await screen.findByLabelText('Available from')).toBeInTheDocument();

    await user.click(trigger);
    await waitFor(() => expect(screen.queryByLabelText('Available from')).not.toBeInTheDocument());
  });

  it('shows a Default badge for an inherited (blank) override field', async () => {
    overridesData = [
      {
        id: 'o1',
        targetType: 'STUDENT',
        userId: 's1',
        groupId: null,
        unlockAt: null, // inherited -> Default badge
        dueDate: '2026-09-10T23:59:00Z',
        lateCutoff: null,
        allowLateSubmissions: null,
        user: { firstName: 'Alice', lastName: 'Anderson', email: 'alice@x.edu' },
      },
    ];
    renderCard({ assignment: { ...baseAssignment, assignedToEveryone: false } });

    await screen.findByRole('button', { name: /edit date override for Alice/i });
    // The collapsed summary carries at least one "Default" badge (for the blank From field).
    expect(screen.getAllByText('Default').length).toBeGreaterThanOrEqual(1);
  });

  it('adds a date override from the picker, then removes it', async () => {
    const user = userEvent.setup();
    renderCard();

    await screen.findByRole('heading', { name: /date overrides \(0\)/i });

    // The "Add date override" picker lists eligible students (popover mocked open).
    const option = await screen.findByRole('option', { name: 'Alice Anderson' });
    await user.click(option);

    expect(await screen.findByRole('heading', { name: /date overrides \(1\)/i })).toBeInTheDocument();

    // Remove it (everyone is on, so the row is dropped entirely).
    await user.click(screen.getByRole('button', { name: /remove date override for Alice/i }));
    expect(screen.getByRole('heading', { name: /date overrides \(0\)/i })).toBeInTheDocument();
  });
});
