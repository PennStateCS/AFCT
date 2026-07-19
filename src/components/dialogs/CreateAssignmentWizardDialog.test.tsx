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

// The audience selector, reduced to one "Assign only {label}" button per member so a test
// can restrict the audience to a single student/group (which materializes an override row).
vi.mock('@/components/assignments/AudienceSelect', () => ({
  AudienceSelect: ({
    label,
    items,
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
        <button key={item.id} type="button" onClick={() => onChange([item.id])}>
          Assign only {item.label}
        </button>
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

const students = [
  { id: 'stu-1', firstName: 'Sam', lastName: 'Student', email: 's@example.com' },
  { id: 'stu-2', firstName: 'Pat', lastName: 'Pupil', email: 'p@example.com' },
];

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
  it('creates the assignment with assignee rows for a restricted audience', async () => {
    const user = userEvent.setup();
    const { setOpen, onCreate } = renderDialog();

    await user.type(screen.getByLabelText('Title'), 'Homework 1');
    await clickNext(user); // -> Type
    await clickNext(user); // -> Assign To (Individual is the default type)

    // Restrict the audience from "all students" to just one student; that student rides in
    // the create body as an assignee (WHO is assigned), not a separate override call.
    await user.click(await screen.findByRole('button', { name: 'Assign only Sam Student' }));
    await clickNext(user); // -> Review

    // Reaching Review must not have submitted yet.
    expect(postCalls('/assignments')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: /create assignment/i }));

    await waitFor(() => expect(postCalls('/assignments').length).toBeGreaterThan(0));

    const assignmentPost = postCalls('/assignments').find((c) => !String(c[0]).includes('/overrides'));
    const body = JSON.parse((assignmentPost?.[1] as RequestInit).body as string);
    // Individual (no groupSetId), unpublished, restricted audience with the one assignee.
    expect(body).toMatchObject({
      title: 'Homework 1',
      isPublished: false,
      assignedToEveryone: false,
      assignees: [{ userId: 'stu-1' }],
    });
    expect(body.groupSetId).toBeUndefined();
    expect(body).toHaveProperty('dueDate');

    // No separate override calls anymore; the audience is in the create body.
    expect(postCalls('/overrides')).toHaveLength(0);

    expect(toastSuccessMock).toHaveBeenCalledWith('Assignment created');
    expect(onCreate).toHaveBeenCalled();
    expect(setOpen).toHaveBeenCalledWith(false);
  });

  it('creates a group assignment pinned to the chosen group set (all groups by default)', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText('Title'), 'Homework 1');
    await clickNext(user); // -> Type
    // Choose Group, then pick the group set it runs in (required to advance).
    await user.click(screen.getByRole('radio', { name: /^Group/ }));
    await user.selectOptions(await screen.findByLabelText('Group set'), 'gs-1');
    await clickNext(user); // -> Assign To (defaults to all groups)
    await clickNext(user); // -> Review
    await user.click(screen.getByRole('button', { name: /create assignment/i }));

    // Created as a group assignment (groupSetId pinned) assigned to everyone (all groups);
    // no assignee rows are needed for the default audience.
    await waitFor(() => expect(postCalls('/assignments').length).toBeGreaterThan(0));
    const assignmentPost = postCalls('/assignments').find(
      (c) => !String(c[0]).includes('/overrides'),
    );
    const body = JSON.parse((assignmentPost?.[1] as RequestInit).body as string);
    expect(body).toMatchObject({ groupSetId: 'gs-1', assignedToEveryone: true });
    expect(body.assignees).toBeUndefined();
    expect(postCalls('/overrides')).toHaveLength(0);
  });

  it('clears the audience when the Type is switched (no cross-type assignees)', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText('Title'), 'Homework 1');
    await clickNext(user); // -> Type
    await user.click(screen.getByRole('radio', { name: /^Group/ }));
    await user.selectOptions(await screen.findByLabelText('Group set'), 'gs-1');
    await clickNext(user); // -> Assign To

    // Restrict to one group (materializes a group assignee row + assignedToEveryone false).
    await user.click(await screen.findByRole('button', { name: /Assign only Team A/ }));

    // Go back and switch to Individual; the group audience must not carry over.
    await user.click(screen.getByRole('button', { name: /^back$/i }));
    await user.click(screen.getByRole('radio', { name: /^Individual/ }));
    await clickNext(user); // -> Assign To (individual, everyone)
    await clickNext(user); // -> Review
    await user.click(screen.getByRole('button', { name: /create assignment/i }));

    await waitFor(() => expect(postCalls('/assignments').length).toBeGreaterThan(0));
    const body = JSON.parse((postCalls('/assignments')[0][1] as RequestInit).body as string);
    expect(body).toMatchObject({ assignedToEveryone: true });
    expect(body.groupSetId).toBeUndefined();
    expect(body.assignees).toBeUndefined();
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

  it('requires a group set before leaving the Type step for a group assignment', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText('Title'), 'Homework 1');
    await clickNext(user); // -> Type
    await user.click(screen.getByRole('radio', { name: /^Group/ }));
    // The group set dropdown loads, but leave it unselected and try to advance.
    await screen.findByLabelText('Group set');
    await clickNext(user);

    // Held on Type: a validation message shows and Assign To never mounts.
    expect(await screen.findByText(/select a group set/i)).toBeInTheDocument();
    expect(screen.queryByText('Assignment audience')).not.toBeInTheDocument();
  });

  it('holds on the Details step when the title is missing', async () => {
    const user = userEvent.setup();
    renderDialog();

    await clickNext(user);

    // Assign To never mounts (its "Assignment audience" section is absent).
    expect(screen.queryByText('Assignment audience')).not.toBeInTheDocument();
  });
});
