/** @vitest-environment jsdom */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SwitchField from './SwitchField';

describe('SwitchField', () => {
  it('wires label, description, and aria attributes', () => {
    render(
      <SwitchField
        label="Autograder"
        name="autograder"
        checked={false}
        onCheckedChange={() => {}}
        description="Enable automatic grading"
        additionalDescribedBy="autograder-hint"
      />,
    );

    const control = screen.getByRole('switch', { name: 'Autograder' });
    expect(control).toHaveAttribute('aria-describedby', 'autograder-desc autograder-hint');
    expect(screen.getByText('Enable automatic grading')).toHaveAttribute('id', 'autograder-desc');
  });

  it('calls onCheckedChange when toggled', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();

    render(
      <SwitchField
        label="Unlimited"
        name="unlimited"
        checked={false}
        onCheckedChange={onCheckedChange}
      />,
    );

    await user.click(screen.getByRole('switch', { name: 'Unlimited' }));
    expect(onCheckedChange).toHaveBeenCalled();
  });

  it('shows error and marks invalid', () => {
    render(
      <SwitchField
        label="Autograder"
        name="autograder"
        checked={true}
        onCheckedChange={() => {}}
        error="Autograder setting is required"
      />,
    );

    expect(screen.getByText('Autograder setting is required')).toHaveAttribute(
      'id',
      'autograder-error',
    );
    expect(screen.getByRole('switch', { name: 'Autograder' })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
  });

  it('supports inline description under label', () => {
    render(
      <SwitchField
        label="Allow Late Submissions"
        name="allow-late-submissions"
        checked={true}
        onCheckedChange={() => {}}
        description="Students can submit after the deadline until a cutoff date."
        descriptionPlacement="inline"
      />,
    );

    expect(
      screen.getByText('Students can submit after the deadline until a cutoff date.'),
    ).toHaveAttribute('id', 'allow-late-submissions-desc');
    expect(screen.getByRole('switch', { name: 'Allow Late Submissions' })).toHaveAttribute(
      'aria-describedby',
      'allow-late-submissions-desc',
    );
  });

  // The row is the hit target, not the 20px switch: the setting's name is a real
  // <label htmlFor> pointing at Radix's <button role="switch">, which is labelable.
  it('toggles when the setting name is clicked, so the row is the hit target', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();

    render(
      <SwitchField
        label="24-hour clock"
        name="clock"
        checked={false}
        onCheckedChange={onCheckedChange}
      />,
    );

    await user.click(screen.getByText('24-hour clock'));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('names the switch from the visible label, without a competing aria-label', () => {
    render(<SwitchField label="Autograder" name="autograder" checked onCheckedChange={() => {}} />);

    const control = screen.getByRole('switch', { name: 'Autograder' });
    expect(control).not.toHaveAttribute('aria-label');
    expect(control).toHaveAttribute('aria-labelledby', 'autograder-label');
  });

  // The same error-wins rule as every other field, for the below placement. An inline
  // description stays put: it is part of the row rather than a message under it.
  it('replaces a below-placed description with the error', () => {
    render(
      <SwitchField
        label="Autograder"
        name="autograder"
        checked
        onCheckedChange={() => {}}
        description="Enable automatic grading"
        error="Autograder setting is required"
      />,
    );

    expect(screen.queryByText('Enable automatic grading')).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Autograder' })).toHaveAttribute(
      'aria-describedby',
      'autograder-error',
    );
  });

  it('keeps an inline description alongside the error', () => {
    render(
      <SwitchField
        label="Autograder"
        name="autograder"
        checked
        onCheckedChange={() => {}}
        description="Enable automatic grading"
        descriptionPlacement="inline"
        error="Autograder setting is required"
      />,
    );

    expect(screen.getByText('Enable automatic grading')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Autograder' })).toHaveAttribute(
      'aria-describedby',
      'autograder-error autograder-desc',
    );
  });

  // The row is a settings row, not a field box. It used to render inside border-input +
  // shadow-xs, which is the boundary of something you type into, so a column of toggles
  // read as a stack of empty text inputs. Asserted structurally rather than by class
  // string: what matters is that no bordered container wraps the label and the switch.
  it('does not wrap the row in a field box', () => {
    render(
      <SwitchField
        label="24-hour clock"
        name="clock"
        checked={false}
        onCheckedChange={() => {}}
        description="Display times on a 24-hour clock."
        descriptionPlacement="inline"
      />,
    );

    const row = screen.getByRole('switch', { name: '24-hour clock' }).parentElement;
    expect(row).not.toBeNull();
    expect(row?.className).not.toMatch(/\bborder\b/);
    expect(row?.className).not.toMatch(/shadow-/);
  });

  it('keeps the label and the switch on one row, with the text able to shrink', () => {
    render(
      <SwitchField
        label="Allow user signup"
        name="signup"
        checked
        onCheckedChange={() => {}}
        description="Anyone with an email address can create an account."
        descriptionPlacement="inline"
      />,
    );

    const control = screen.getByRole('switch', { name: 'Allow user signup' });
    const row = control.parentElement as HTMLElement;

    // The switch never shrinks; the text block does, so a long description wraps rather
    // than widening the row and pushing the switch out of view at 390px.
    expect(control.className).toMatch(/shrink-0/);
    const textBlock = row.firstElementChild as HTMLElement;
    expect(textBlock.className).toMatch(/min-w-0/);
    expect(textBlock).toContainElement(screen.getByText('Allow user signup'));
  });

  // The whole point of the label association: the 20x36 switch is not the only target.
  it('gives the label a pointer cursor, and takes it away when disabled', () => {
    const { rerender } = render(
      <SwitchField label="Autograder" name="ag" checked onCheckedChange={() => {}} />,
    );
    expect(screen.getByText('Autograder').className).toMatch(/cursor-pointer/);

    rerender(
      <SwitchField label="Autograder" name="ag" checked onCheckedChange={() => {}} disabled />,
    );
    expect(screen.getByText('Autograder').className).toMatch(/cursor-not-allowed/);
  });

  // Clicking the name of a disabled setting must not change it. The browser skips label
  // activation for a disabled control, but that is a behaviour worth pinning down rather
  // than assuming, because the label still looks like text you can click.
  it('does not toggle when the label of a disabled switch is clicked', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();

    render(
      <SwitchField
        label="Send email from this site"
        name="email-enabled"
        checked={false}
        onCheckedChange={onCheckedChange}
        disabled
      />,
    );

    await user.click(screen.getByText('Send email from this site'));
    expect(onCheckedChange).not.toHaveBeenCalled();
    expect(screen.getByRole('switch', { name: 'Send email from this site' })).toBeDisabled();
  });

  it('activates from the keyboard', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();

    render(
      <SwitchField
        label="Published"
        name="published"
        checked={false}
        onCheckedChange={onCheckedChange}
      />,
    );

    await user.tab();
    expect(screen.getByRole('switch', { name: 'Published' })).toHaveFocus();

    await user.keyboard(' ');
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  // The description must stay OUT of the accessible name. Inside the <label> it would be
  // read every time the control was announced: "24-hour clock Display times on a...".
  it('keeps the description out of the accessible name', () => {
    render(
      <SwitchField
        label="24-hour clock"
        name="clock"
        checked={false}
        onCheckedChange={() => {}}
        description="Display times on a 24-hour clock instead of 12-hour AM/PM."
        descriptionPlacement="inline"
      />,
    );

    // Would throw if the name had absorbed the description.
    const control = screen.getByRole('switch', { name: '24-hour clock' });
    expect(control).toHaveAttribute('aria-describedby', 'clock-desc');
  });
});
