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

  it('marks a required field both visibly and programmatically', () => {
    render(
      <SelectField
        label="Timezone"
        name="timezone"
        value=""
        onValueChange={() => {}}
        requiredMark
        placeholder="Select timezone"
      />,
    );

    // Visible "*" for sighted users, aria-required on the trigger for assistive tech.
    const marker = screen.getByText(
      (text, node) => node?.tagName === 'SPAN' && text.trim() === '*',
    );
    expect(marker).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('combobox', { name: 'Timezone' })).toHaveAttribute(
      'aria-required',
      'true',
    );
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

  // The InputGroup rule, now shared: one message under a field, and the error wins. A
  // field that carried both grew taller as it was filled in, and the described-by named
  // the description that was no longer the point.
  it('replaces the description with the error, and stops describing the description', () => {
    render(
      <SelectField
        label="Role"
        name="role"
        value=""
        onValueChange={() => {}}
        description="Who this person is in the course."
        error="Role is required"
        placeholder="Select role"
      />,
    );

    expect(screen.queryByText('Who this person is in the course.')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Role' })).toHaveAttribute(
      'aria-describedby',
      'role-error',
    );
  });

  it('keeps both when the caller opts in with showDescriptionWithError', () => {
    render(
      <SelectField
        label="Role"
        name="role"
        value=""
        onValueChange={() => {}}
        description="Who this person is in the course."
        error="Role is required"
        showDescriptionWithError
        placeholder="Select role"
      />,
    );

    expect(screen.getByText('Who this person is in the course.')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Role' })).toHaveAttribute(
      'aria-describedby',
      'role-error role-desc',
    );
  });

  // The trigger's name has to come from the visible label alone. It carried aria-label as
  // well, so a caller changing one and not the other would have gone unnoticed.
  it('names the trigger from the visible label, without a competing aria-label', () => {
    render(
      <SelectField
        label="Timezone"
        name="timezone"
        value=""
        onValueChange={() => {}}
        placeholder="Select timezone"
      />,
    );

    const combobox = screen.getByRole('combobox', { name: 'Timezone' });
    expect(combobox).not.toHaveAttribute('aria-label');
    expect(combobox).toHaveAttribute('aria-labelledby', 'timezone-label');
  });

  // The wrapper must not restate the primitive's styling: that is what let the two drift.
  // data-size is the contract, so a change to the form size lands in one place.
  it('asks SelectTrigger for the form size rather than restyling it', () => {
    render(
      <SelectField
        label="Timezone"
        name="timezone"
        value=""
        onValueChange={() => {}}
        placeholder="Select timezone"
      />,
    );

    expect(screen.getByRole('combobox', { name: 'Timezone' })).toHaveAttribute('data-size', 'form');
  });

  it('passes a disabled field through to the trigger', () => {
    render(
      <SelectField
        label="Timezone"
        name="timezone"
        value=""
        onValueChange={() => {}}
        disabled
        placeholder="Select timezone"
      />,
    );

    expect(screen.getByRole('combobox', { name: 'Timezone' })).toBeDisabled();
  });
});
