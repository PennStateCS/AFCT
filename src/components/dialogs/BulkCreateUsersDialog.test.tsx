/** @vitest-environment jsdom */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BulkCreateUsersDialog } from './BulkCreateUsersDialog';

vi.mock('@/components/ui/dialog', () => import('@/test/mocks/ui').then((mod) => mod.dialogMock));

const globalWithReact = globalThis as typeof globalThis & { React?: typeof React };
globalWithReact.React = React;

const originalFetch = global.fetch;
const fetchMock = vi.fn();

describe('BulkCreateUsersDialog', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('parses CSV and submits to bulk user endpoint', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        summary: { total: 2, created: 1, failed: 1 },
        created: [{ row: 2, email: 'ada@example.com', userId: 'u1' }],
        failed: [{ row: 3, email: 'exists@example.com', reason: 'Username already exists' }],
      }),
    } as Response);

    render(<BulkCreateUsersDialog open setOpen={vi.fn()} onSuccess={onSuccess} />);

    const fileInput = screen.getByLabelText('CSV file') as HTMLInputElement;
    const csvFile = {
      name: 'users.csv',
      text: async () =>
        [
          'first name,last name,email,password',
          'Ada,Lovelace,ada@example.com,StrongPass1!',
          'Exists,User,exists@example.com,StrongPass1!',
        ].join('\n'),
    };

    fireEvent.change(fileInput, { target: { files: [csvFile] } });

    await waitFor(() => {
      expect(
        screen.getByText('Parsed 2 row(s). Import will skip invalid rows.'),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Import Users' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/users/bulk');
    expect(requestInit).toMatchObject({ method: 'POST' });

    expect(onSuccess).toHaveBeenCalled();
    expect(screen.getByText('Added (1)')).toBeInTheDocument();
    expect(screen.getByText('Failed (1)')).toBeInTheDocument();
  });

  it('shows a parse error when required headers are missing', async () => {
    render(<BulkCreateUsersDialog open setOpen={vi.fn()} onSuccess={vi.fn()} />);

    const fileInput = screen.getByLabelText('CSV file') as HTMLInputElement;
    const csvFile = {
      name: 'users.csv',
      text: async () => 'email,password\nada@example.com,StrongPass1!',
    };

    fireEvent.change(fileInput, { target: { files: [csvFile] } });

    await waitFor(() => {
      expect(
        screen.getByText('CSV must include first name, last name, email, and password headers.'),
      ).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: 'Import Users' })).toBeDisabled();
  });
});
