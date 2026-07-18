/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { CreateAssignmentWizardDialog } from './CreateAssignmentWizardDialog';

const { toastSuccessMock, toastErrorMock, toastWarningMock } = vi.hoisted(() => ({
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastWarningMock: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: toastSuccessMock, error: toastErrorMock, warning: toastWarningMock },
}));

vi.mock('@/components/ui/InputGroup', () => ({
  __esModule: true,
  default: ({
    label,
    fieldProps = {},
    type = 'text',
  }: {
    label: string;
    fieldProps?: { value?: string; onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void };
    type?: string;
  }) => (
    <label>
      {label}
      <input
        aria-label={label}
        type={type}
        value={fieldProps?.value ?? ''}
        onChange={(e) => fieldProps?.onChange?.(e)}
      />
    </label>
  ),
}));

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

vi.mock('@/components/ui/SearchableMultiSelect', () => ({
  SearchableMultiSelect: ({
    label,
    items,
    value,
    onChange,
  }: {
    label: string;
    items: Array<{ id: string; label: string }>;
    value: string[];
    onChange: (next: string[]) => void;
  }) => (
    <fieldset>
      <legend>{label}</legend>
      {items.map((item) => (
        <label key={item.id}>
          {item.label}
          <input
            type="checkbox"
            aria-label={item.label}
            checked={(value ?? []).includes(item.id)}
            onChange={() => {
              const set = new Set(value ?? []);
              if (set.has(item.id)) set.delete(item.id);
              else set.add(item.id);
              onChange(Array.from(set));
            }}
          />
        </label>
      ))}
    </fieldset>
  ),
}));

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

vi.mock('@/components/ui/dialog', () => {
  const Wrapper = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;
  return {
    Dialog: Wrapper,
    DialogContent: Wrapper,
    DialogHeader: Wrapper,
    DialogTitle: Wrapper,
    DialogDescription: Wrapper,
    DialogFooter: Wrapper,
    DialogClose: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

const originalFetch = global.fetch;

const ok = (data: unknown) => ({
  ok: true,
  status: 200,
  json: async () => data,
  text: async () => JSON.stringify(data),
});

const students = [{ id: 'stu-1', firstName: 'Sam', lastName: 'Student', email: 's@example.com' }];

const groupSets = [
  { id: 'gs-1', name: 'Project Teams', locked: false, groupCount: 1, assignedCount: 1 },
];
const groupSetDetail = {
  id: 'gs-1',
  name: 'Project Teams',
  locked: false,
  basis: 'b1',
  eligibleStudents: [],
  groups: [
    {
      id: 'grp-1',
      name: 'Team A',
      members: [
        { id: 'stu-2', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', inactive: false },
      ],
    },
  ],
};

let studentsResp: () => ReturnType<typeof ok>;
let assignmentResp: () => ReturnType<typeof ok>;
let overrideResp: () => ReturnType<typeof ok>;

const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  const u = String(url);
  const method = (init?.method ?? 'GET').toUpperCase();
  if (method === 'GET' && u.includes('/students')) return studentsResp() as unknown as Response;
  // Group-set detail (has an id segment) before the group-set list.
  if (method === 'GET' && u.includes('/group-sets/')) return ok(groupSetDetail) as unknown as Response;
  if (method === 'GET' && u.includes('/group-sets')) return ok(groupSets) as unknown as Response;
  if (method === 'POST' && u.includes('/overrides')) return overrideResp() as unknown as Response;
  if (method === 'POST' && u.includes('/assignments')) return assignmentResp() as unknown as Response;
  throw new Error(`Unexpected fetch: ${method} ${u}`);
});

const postCalls = (matcher: string) =>
  fetchMock.mock.calls.filter(
    ([url, init]) =>
      ((init as RequestInit | undefined)?.method ?? 'GET').toUpperCase() === 'POST' &&
      String(url).includes(matcher),
  );

const clickNext = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: /^next$/i }));

const renderDialog = () => {
  const setOpen = vi.fn();
  const onCreate = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={queryClient}>
      <CreateAssignmentWizardDialog
        open
        setOpen={setOpen}
        courseId="c1"
        courseIsArchived={false}
        timeZone="UTC"
        onCreate={onCreate}
      />
    </QueryClientProvider>,
  );
  return { setOpen, onCreate };
};

beforeEach(() => {
  fetchMock.mockClear();
  studentsResp = () => ok(students);
  assignmentResp = () => ok({ id: 'a1' });
  overrideResp = () => ok({ id: 'o1' });
  global.fetch = fetchMock as unknown as typeof fetch;
  toastSuccessMock.mockReset();
  toastErrorMock.mockReset();
  toastWarningMock.mockReset();
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe('CreateAssignmentWizardDialog', () => {
  it('creates the assignment then posts a per-student override', async () => {
    const user = userEvent.setup();
    const { setOpen, onCreate } = renderDialog();

    await user.type(screen.getByLabelText('Title'), 'Homework 1');
    await clickNext(user); // -> Assign To

    // Assigned to everyone by default; add a date override for one student via the
    // "Add date override" picker, then proceed.
    await user.click(await screen.findByRole('button', { name: 'Sam Student' }));
    await clickNext(user); // -> Options
    await clickNext(user); // -> Review

    // Reaching Review must not have submitted yet.
    expect(postCalls('/assignments')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: /create assignment/i }));

    await waitFor(() => expect(postCalls('/assignments').length).toBeGreaterThan(0));

    const assignmentPost = postCalls('/assignments').find((c) => !String(c[0]).includes('/overrides'));
    const body = JSON.parse((assignmentPost?.[1] as RequestInit).body as string);
    expect(body).toMatchObject({ title: 'Homework 1' });
    expect(body).toHaveProperty('dueDate');

    await waitFor(() => expect(postCalls('/overrides').length).toBe(1));
    const overridePost = postCalls('/overrides')[0];
    expect(JSON.parse((overridePost[1] as RequestInit).body as string)).toMatchObject({
      userId: 'stu-1',
    });

    expect(toastSuccessMock).toHaveBeenCalledWith('Assignment created');
    expect(onCreate).toHaveBeenCalled();
    expect(setOpen).toHaveBeenCalledWith(false);
  });

  it('creates the assignment then posts a group override with { groupId }', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText('Title'), 'Homework 1');
    await clickNext(user); // -> Assign To

    // Assign to specific targets: turn off "everyone", pick a group set, then check one
    // of its groups as the audience target.
    await user.click(screen.getByRole('switch', { name: /assign to everyone in the course/i }));
    await user.click(await screen.findByRole('button', { name: 'Project Teams (1 group)' }));
    await user.click(await screen.findByRole('checkbox', { name: 'Team A (1 member)' }));

    await clickNext(user); // -> Options
    await clickNext(user); // -> Review
    await user.click(screen.getByRole('button', { name: /create assignment/i }));

    await waitFor(() => expect(postCalls('/overrides').length).toBe(1));
    const overridePost = postCalls('/overrides')[0];
    const body = JSON.parse((overridePost[1] as RequestInit).body as string);
    expect(body).toMatchObject({ groupId: 'grp-1' });
    expect(body).not.toHaveProperty('userId');
  });

  it('shows an error toast and does not close when assignment creation fails', async () => {
    const user = userEvent.setup();
    assignmentResp = () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Bad assignment' }),
      text: async () => JSON.stringify({ error: 'Bad assignment' }),
    });
    const { setOpen } = renderDialog();

    await user.type(screen.getByLabelText('Title'), 'Homework 1');
    await clickNext(user);
    await clickNext(user);
    await clickNext(user);
    await user.click(screen.getByRole('button', { name: /create assignment/i }));

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('Bad assignment'));
    expect(postCalls('/overrides')).toHaveLength(0);
    expect(setOpen).not.toHaveBeenCalledWith(false);
  });

  it('holds on the Details step when the title is missing', async () => {
    const user = userEvent.setup();
    renderDialog();

    await clickNext(user);

    // Assign To never mounts (its "Assignment audience" section is absent).
    expect(screen.queryByText('Assignment audience')).not.toBeInTheDocument();
  });
});
