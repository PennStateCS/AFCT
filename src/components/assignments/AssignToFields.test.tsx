/** @vitest-environment jsdom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';

import { AssignToFields } from './AssignToFields';
import { AssignmentWizardFormSchema } from '@/schemas/assignment';

type FormValues = z.input<typeof AssignmentWizardFormSchema>;

// Keep the pickers trivial to drive: single-selects render each item as a button, the
// multi-select renders each item as a checkbox.
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

// The audience chips multiselect, reduced to Clear / Select all buttons plus the error.
vi.mock('@/components/assignments/AudienceSelect', () => ({
  AudienceSelect: ({
    label,
    items,
    onChange,
    error,
  }: {
    label: string;
    items: Array<{ id: string; label: string }>;
    value: string[];
    onChange: (next: string[]) => void;
    error?: string;
  }) => (
    <fieldset>
      <legend>{label}</legend>
      <button type="button" onClick={() => onChange([])}>
        Clear audience
      </button>
      <button type="button" onClick={() => onChange(items.map((i) => i.id))}>
        Select all audience
      </button>
      {error ? <p role="alert">{error}</p> : null}
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

const fetchMock = vi.fn(async (url: string) => {
  const u = String(url);
  if (u.includes('/students')) return ok(students) as unknown as Response;
  if (u.includes('/group-sets')) return ok(groupSets) as unknown as Response;
  throw new Error(`Unexpected fetch: ${u}`);
});

function Harness() {
  const { control, formState } = useForm<FormValues>({
    resolver: zodResolver(AssignmentWizardFormSchema),
    defaultValues: {
      title: 'Homework',
      description: '',
      dueDate: '2026-02-01T23:59',
      unlockAt: undefined,
      assignedToEveryone: true,
      allowLateSubmissions: false,
      lateCutoff: undefined,
      isPublished: false,
      courseId: 'c1',
      overrides: [],
    },
    mode: 'onChange',
  });
  return <AssignToFields control={control} errors={formState.errors} courseId="c1" active />;
}

const renderFields = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  fetchMock.mockClear();
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe('AssignToFields', () => {
  it('adds a date override as a compact row that collapses to Default badges and expands to edit', async () => {
    const user = userEvent.setup();
    renderFields();

    // Add a date override for a student (assigned to everyone by default).
    await user.click(await screen.findByRole('button', { name: 'Sam Student' }));

    // Freshly added rows auto-expand: the inline editor is visible.
    expect(screen.getByLabelText('Available from')).toBeInTheDocument();
    expect(screen.getByText('Date overrides (1)')).toBeInTheDocument();
    const overrideTrigger = screen.getByRole('button', {
      name: 'Edit date override for Sam Student',
    });
    expect(overrideTrigger).toHaveFocus();

    // Collapse the row: it now shows a one-line summary with a Default badge for each
    // inherited date field (Available from + Due are both blank -> inherit).
    await user.click(overrideTrigger);
    expect(screen.getAllByText('Default').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Default: closes at due')).toBeInTheDocument();
    expect(screen.queryByLabelText('Available from')).not.toBeInTheDocument();

    // Expand again: badges/summary give way to the editor.
    await user.click(screen.getByRole('button', { name: 'Edit date override for Sam Student' }));
    expect(screen.getByLabelText('Available from')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Edit date override for Sam Student' }),
    ).toHaveAttribute('aria-expanded', 'true');
  });

  it('shows an error when the audience is cleared to no one', async () => {
    const user = userEvent.setup();
    renderFields();

    await user.click(screen.getByRole('button', { name: /clear audience/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/select at least one student/i);
  });
});
