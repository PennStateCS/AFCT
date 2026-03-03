/** @vitest-environment jsdom */

import React from 'react';
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SelectField from './SelectField';
import { SelectContent, SelectItem } from './select';

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  const globalAny = globalThis as Record<string, unknown>;

  if (!globalAny.ResizeObserver) {
    globalAny.ResizeObserver = ResizeObserverMock;
  }

  if (!HTMLElement.prototype.scrollIntoView) {
    HTMLElement.prototype.scrollIntoView = () => {};
  }

  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = () => {};
  }

  if (!HTMLElement.prototype.releasePointerCapture) {
    HTMLElement.prototype.releasePointerCapture = () => {};
  }

  if (!HTMLElement.prototype.hasPointerCapture) {
    HTMLElement.prototype.hasPointerCapture = () => false;
  }
});

describe('SelectField', () => {
  it('wires the label, description, and aria attributes to the trigger', () => {
    render(
      <SelectField
        label="Timezone"
        name="timezone"
        value=""
        onValueChange={() => {}}
        description="Pick a timezone"
        additionalDescribedBy="timezone-hint"
        placeholder="Select timezone"
      />,
    );

    const combobox = screen.getByRole('combobox', { name: 'Timezone' });

    expect(combobox).toHaveAttribute('aria-describedby', 'timezone-desc timezone-hint');
    expect(screen.getByText('Pick a timezone')).toHaveAttribute('id', 'timezone-desc');
  });

  it('renders provided options and notifies on selection', async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();

    render(
      <SelectField
        label="Timezone"
        name="timezone"
        placeholder="Select timezone"
        value=""
        onValueChange={handleChange}
        options={[
          { value: 'UTC', label: 'Coordinated Universal Time' },
          { value: 'PST', label: 'Pacific Time' },
        ]}
      />,
    );

    await user.click(screen.getByRole('combobox', { name: 'Timezone' }));
    await user.click(await screen.findByRole('option', { name: 'Coordinated Universal Time' }));

    expect(handleChange).toHaveBeenCalledWith('UTC');
  });

  it('accepts custom select content via children', async () => {
    const user = userEvent.setup();

    render(
      <SelectField label="Role" name="role" value="" onValueChange={() => {}} placeholder="Role">
        <SelectContent>
          <SelectItem value="admin">Admin</SelectItem>
        </SelectContent>
      </SelectField>,
    );

    await user.click(screen.getByRole('combobox', { name: 'Role' }));

    expect(await screen.findByRole('option', { name: 'Admin' })).toBeInTheDocument();
  });

  it('shows error feedback and marks the trigger invalid', () => {
    render(
      <SelectField
        label="Role"
        name="role"
        value=""
        onValueChange={() => {}}
        error="Role is required"
        placeholder="Select role"
      />,
    );

    expect(screen.getByText('Role is required')).toHaveAttribute('id', 'role-error');
    expect(screen.getByRole('combobox', { name: 'Role' })).toHaveAttribute('aria-invalid', 'true');
  });
});
