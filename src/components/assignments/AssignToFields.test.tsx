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

const fetchMock = vi.fn(async (url: string) => {
  const u = String(url);
  if (u.includes('/students')) return ok(students) as unknown as Response;
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
  it('shows an error when the audience is cleared to no one', async () => {
    const user = userEvent.setup();
    renderFields();

    await user.click(screen.getByRole('button', { name: /clear audience/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/select at least one student/i);
  });
});
