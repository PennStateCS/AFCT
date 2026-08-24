/** @vitest-environment jsdom */

import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import InputGroup from './InputGroup';

describe('InputGroup', () => {
  it('links label, description, and error messaging via aria attributes', () => {
    render(
      <InputGroup
        label="Course Name"
        name="courseName"
        description="Enter the official course name"
        error="Course name is required"
        additionalDescribedBy="custom-hint"
        requiredMark
        showDescriptionWithError
      />,
    );

    const input = screen.getByLabelText(/^Course Name/);

    expect(input).toHaveAttribute(
      'aria-describedby',
      'courseName-error courseName-desc custom-hint',
    );
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Enter the official course name')).toHaveAttribute(
      'id',
      'courseName-desc',
    );
    expect(screen.getByText('Course name is required')).toHaveAttribute('id', 'courseName-error');
    // Required is conveyed both ways: a visible "*" for sighted users (aria-hidden, so
    // it isn't read as "asterisk") and aria-required on the input for assistive tech.
    const marker = screen.getByText(
      (text, node) => node?.tagName === 'SPAN' && text.trim() === '*',
    );
    expect(marker).toBeInTheDocument();
    expect(marker).toHaveAttribute('aria-hidden', 'true');
    expect(input).toHaveAttribute('aria-required', 'true');
  });

  it('accepts an array of additional described-by ids and emits each one once', () => {
    render(
      <InputGroup
        label="Handle"
        name="handle"
        description="Pick something short"
        additionalDescribedBy={['handle-desc', 'rules-hint', 'rules-hint']}
      />,
    );

    const ids = (screen.getByLabelText('Handle').getAttribute('aria-describedby') ?? '').split(' ');

    // handle-desc is already the description's own id, and rules-hint was passed twice.
    // A repeated id is read out twice, so the attribute has to be deduplicated.
    expect(ids).toEqual(['handle-desc', 'rules-hint']);
  });

  it('gives the label class to the label and nothing else', () => {
    render(<InputGroup label="Title" name="title" labelClassName="text-status-success" />);

    expect(screen.getByText('Title')).toHaveClass('text-status-success');
    expect(screen.getByLabelText('Title')).not.toHaveClass('text-status-success');
  });
});

/**
 * Which handler runs, and in what order.
 *
 * The component used to inherit every input prop except `onChange`, which made it look
 * general purpose while quietly ignoring the one handler every caller reaches for first.
 */
describe('value changes', () => {
  it('delegates change and blur events to the provided field props', () => {
    const onChange = vi.fn();
    const onBlur = vi.fn();

    render(
      <InputGroup
        label="Email"
        name="email"
        fieldProps={{ name: 'email', value: '', onChange, onBlur }}
      />,
    );

    const input = screen.getByLabelText('Email');

    fireEvent.change(input, { target: { value: 'demo@example.com' } });
    fireEvent.blur(input);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  it('falls back to setValue when field props are not provided', () => {
    const setValue = vi.fn();

    render(<InputGroup label="Username" name="username" setValue={setValue} />);

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'next-user' } });

    expect(setValue).toHaveBeenCalledWith('next-user');
  });

  it('supports a plain onChange the way a native input would', async () => {
    const user = userEvent.setup();

    function Controlled() {
      const [value, setValue] = useState('');
      return (
        <InputGroup
          label="Search"
          name="search"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      );
    }

    render(<Controlled />);

    await user.type(screen.getByLabelText('Search'), 'abc');

    expect(screen.getByLabelText('Search')).toHaveValue('abc');
  });

  it('calls onChange exactly once per keystroke', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<InputGroup label="Code" name="code" value="" onChange={onChange} />);

    await user.type(screen.getByLabelText('Code'), 'x');

    // Once, not twice: onChange is handled here and must not also reach the input
    // through the rest-spread.
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('lets the form library own the value when both a field binding and setValue are given', () => {
    const fieldOnChange = vi.fn();
    const onChange = vi.fn();
    const setValue = vi.fn();

    render(
      <InputGroup
        label="Title"
        name="title"
        fieldProps={{ value: '', onChange: fieldOnChange }}
        onChange={onChange}
        setValue={setValue}
      />,
    );

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Regular Languages' } });

    expect(fieldOnChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(1);
    // Suppressed, so the value is not written down two different paths.
    expect(setValue).not.toHaveBeenCalled();
  });

  it('stays controlled when a value is supplied', async () => {
    const user = userEvent.setup();

    // No handler at all: a controlled field with nothing to update it must not drift.
    render(<InputGroup label="Email" name="email" value="fixed@example.edu" />);

    await user.type(screen.getByLabelText('Email'), 'x');

    expect(screen.getByLabelText('Email')).toHaveValue('fixed@example.edu');
  });

  it('stays uncontrolled when only defaultValue is supplied', async () => {
    const user = userEvent.setup();
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(<InputGroup label="Nickname" name="nickname" defaultValue="ada" />);

    const input = screen.getByLabelText('Nickname');
    expect(input).toHaveValue('ada');

    await user.type(input, '!');
    expect(input).toHaveValue('ada!');

    // The controlled/uncontrolled warning is a console.error; it must not appear.
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('the password toggle', () => {
  it('toggles password visibility internally when showEye is enabled', async () => {
    const user = userEvent.setup();

    render(<InputGroup label="Password" name="password" type="password" showEye />);

    const toggleButton = screen.getByRole('button', { name: 'Show password' });
    expect(toggleButton).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');

    await user.click(toggleButton);

    // One model everywhere: a fixed name plus a pressed state. The name used to flip to
    // "Hide password" in this branch and stay put in the other, so the same control
    // announced itself two different ways depending on whether a status icon was shown.
    expect(toggleButton).toHaveAttribute('aria-label', 'Show password');
    expect(toggleButton).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');
  });

  it('announces itself the same way when a status icon is alongside it', async () => {
    const user = userEvent.setup();

    render(
      <InputGroup
        label="Password"
        name="pw"
        type="password"
        showEye
        showStatus
        isValid
        value="a"
      />,
    );

    const toggleButton = screen.getByRole('button', { name: 'Show password' });
    await user.click(toggleButton);

    expect(toggleButton).toHaveAttribute('aria-label', 'Show password');
    expect(toggleButton).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');
  });

  it('activates from the keyboard with the native button behaviour', async () => {
    const user = userEvent.setup();

    render(<InputGroup label="Password" name="password" type="password" showEye />);

    const toggleButton = screen.getByRole('button', { name: 'Show password' });

    // Tab to it rather than clicking, so this is really the keyboard path. The component
    // no longer handles Enter/Space itself; a <button> already does, and the handler that
    // used to be here fired a second time on the click the browser synthesises.
    await user.tab();
    await user.tab();
    expect(toggleButton).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(toggleButton).toHaveAttribute('aria-pressed', 'true');

    await user.keyboard(' ');
    expect(toggleButton).toHaveAttribute('aria-pressed', 'false');
  });

  it('invokes the external password visibility toggle when controlled', async () => {
    const user = userEvent.setup();

    function ControlledPassword() {
      const [visible, setVisible] = useState(false);
      return (
        <InputGroup
          label="Secret"
          name="secret"
          type="password"
          showEye
          isPasswordVisible={visible}
          togglePasswordVisibility={() => setVisible((prev) => !prev)}
        />
      );
    }

    render(<ControlledPassword />);

    const toggleButton = screen.getByRole('button', { name: 'Show password' });

    await user.click(toggleButton);

    expect(toggleButton).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Secret')).toHaveAttribute('type', 'text');
  });
});

describe('the field message', () => {
  it('shows the description while the field is valid', () => {
    render(
      <InputGroup label="Course Code" name="code" description="Normalized to uppercase on save." />,
    );

    expect(screen.getByText('Normalized to uppercase on save.')).toBeInTheDocument();
  });

  it('replaces the description with the error, and stops describing what is gone', () => {
    render(
      <InputGroup
        label="Course Code"
        name="code"
        description="Normalized to uppercase on save."
        error="Course code is required."
      />,
    );

    // One primary message, so a dense form does not stack helper text under an error.
    expect(screen.queryByText('Normalized to uppercase on save.')).not.toBeInTheDocument();
    expect(screen.getByText('Course code is required.')).toBeInTheDocument();

    const ids = screen.getByLabelText('Course Code').getAttribute('aria-describedby') ?? '';
    expect(ids).toContain('code-error');
    // The description element is not rendered, so nothing may point at it.
    expect(ids).not.toContain('code-desc');
  });

  it('keeps both when the description is what you need to fix the error', () => {
    render(
      <InputGroup
        label="New password"
        name="newPassword"
        description="Must be at least 8 characters."
        error="Password is too weak."
        showDescriptionWithError
      />,
    );

    expect(screen.getByText('Must be at least 8 characters.')).toBeInTheDocument();
    expect(screen.getByText('Password is too weak.')).toBeInTheDocument();
    expect(screen.getByLabelText('New password').getAttribute('aria-describedby')).toContain(
      'newPassword-desc',
    );
  });
});

describe('input states', () => {
  it('marks a read-only field read-only without dimming it like a disabled one', () => {
    render(
      <InputGroup
        label="Keyset URL"
        name="keyset"
        value="https://afct/jwks"
        readOnly
        setValue={() => {}}
      />,
    );

    const input = screen.getByLabelText('Keyset URL');
    expect(input).toHaveAttribute('readonly');
    expect(input).not.toBeDisabled();
    // Read-only is its own state: a muted surface and a text cursor, because the value is
    // there to be selected and copied. Disabled inputs get the opacity treatment instead.
    expect(input.className).toContain('bg-muted/40');
    expect(input.className).toContain('cursor-text');
    // The muted surface has to actually win over Input's own bg-card, not just be listed
    // after it, and nothing here dims the field unconditionally: the only opacity left is
    // the disabled: variant, which does not apply.
    expect(input.className).not.toContain('bg-card');
    expect(input.className).not.toMatch(/(^|\s)opacity-/);
  });

  it('leaves a disabled field with the disabled treatment only', () => {
    render(<InputGroup label="Email" name="email" value="a@b.edu" disabled />);

    const input = screen.getByLabelText('Email');
    expect(input).toBeDisabled();
    expect(input.className).not.toContain('bg-muted/40');
  });

  it('keeps the native spinners on a number input', () => {
    render(<InputGroup label="Credits" name="credits" type="number" value="3" min={1} max={6} />);

    const input = screen.getByLabelText('Credits');
    expect(input).toHaveAttribute('type', 'number');
    expect(input).toHaveAttribute('min', '1');
    expect(input).toHaveAttribute('max', '6');
    // Native increment/decrement controls are kept deliberately.
    expect(input.className).toContain('appearance-auto');
  });

  it('forwards a ref to the underlying input', () => {
    const ref = React.createRef<HTMLInputElement>();

    render(<InputGroup ref={ref} label="Title" name="title" value="" setValue={() => {}} />);

    expect(ref.current).toBe(screen.getByLabelText('Title'));
  });
});

/**
 * The valid/invalid text has to reach the field.
 *
 * It was rendered beside the input as the text equivalent of the status icon, and then
 * referenced by nothing: somebody typing into "Confirm new password" was never told it
 * matched, because the information was in the page but not on the control.
 */
describe('the field status', () => {
  it('is named in aria-describedby, so it is read with the field', () => {
    render(
      <InputGroup
        name="pw"
        label="Confirm new password"
        value="abc"
        setValue={() => {}}
        showStatus
        isValid
      />,
    );

    const field = screen.getByLabelText('Confirm new password');
    const describedBy = field.getAttribute('aria-describedby') ?? '';
    expect(describedBy).toContain('-status');

    // And the element it points at exists and says which it is.
    const status = document.getElementById(
      describedBy.split(' ').find((id) => id.endsWith('-status'))!,
    );
    expect(status).toHaveTextContent('valid');
  });

  it('says invalid, and draws the icon from the destructive palette', () => {
    render(
      <InputGroup
        name="pw"
        label="Confirm new password"
        value="abc"
        setValue={() => {}}
        showStatus
        isValid={false}
      />,
    );

    expect(document.getElementById('pw-status')).toHaveTextContent('invalid');
    expect(document.querySelector('svg.text-destructive')).toBeTruthy();
  });

  it('keeps the referenced element present while the field is empty', () => {
    render(
      <InputGroup name="pw" label="New password" value="" setValue={() => {}} showStatus isValid />,
    );

    const field = screen.getByLabelText('New password');
    const id = (field.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .find((x) => x.endsWith('-status'));
    // Present but empty: a description pointing at a missing element is a dangling reference.
    expect(id && document.getElementById(id)).toBeInTheDocument();
  });

  it('shows a spinner while checking and keeps the words for assistive tech', () => {
    const { rerender } = render(
      <InputGroup label="Handle" name="handle" value="demo" showStatus isChecking="Checking" />,
    );

    // The message is in the accessibility tree via the status element, not set inside the
    // field where it would collide with what is being typed.
    const status = document.getElementById('handle-status');
    expect(status).toHaveTextContent('Checking');
    expect(status).toHaveClass('sr-only');
    expect(document.querySelector('span[aria-hidden="true"] span')).toBeTruthy();

    rerender(<InputGroup label="Handle" name="handle" value="demo" showStatus isValid />);

    expect(document.getElementById('handle-status')).toHaveTextContent('valid');
    expect(document.querySelector('svg.text-status-success')).toBeTruthy();
  });

  it('defaults the checking message when isChecking is just true', () => {
    render(<InputGroup label="Handle" name="handle" value="demo" showStatus isChecking />);

    expect(document.getElementById('handle-status')).toHaveTextContent('Checking...');
  });

  it('shows the status and the eye together without either dropping out', async () => {
    const user = userEvent.setup();

    render(
      <InputGroup
        label="New password"
        name="newPassword"
        type="password"
        value="Str0ng!Passw0rd"
        setValue={() => {}}
        showEye
        showStatus
        isValid
      />,
    );

    expect(document.getElementById('newPassword-status')).toHaveTextContent('valid');
    expect(screen.getByRole('button', { name: 'Show password' })).toBeInTheDocument();
    // Both adornments, so the field reserves room for two of them.
    expect(screen.getByLabelText('New password').className).toContain('pr-18');

    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(screen.getByLabelText('New password')).toHaveAttribute('type', 'text');
    expect(document.getElementById('newPassword-status')).toHaveTextContent('valid');
  });
});
