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

  it('toggles password visibility internally when showEye is enabled', async () => {
    const user = userEvent.setup();

    render(<InputGroup label="Password" name="password" type="password" showEye />);

    const toggleButton = screen.getByRole('button', { name: 'Show password' });
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');

    await user.click(toggleButton);

    expect(screen.getByRole('button', { name: 'Hide password' })).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');
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

    expect(screen.getByRole('button', { name: 'Hide password' })).toBeInTheDocument();
    expect(screen.getByLabelText('Secret')).toHaveAttribute('type', 'text');
  });

  it('displays status text while checking and clears it afterward', () => {
    const { rerender } = render(
      <InputGroup label="Handle" name="handle" value="demo" showStatus isChecking="Checking" />,
    );

    expect(screen.getByText('Checking')).toBeInTheDocument();

    rerender(<InputGroup label="Handle" name="handle" value="demo" showStatus isValid />);

    expect(screen.queryByText('Checking')).not.toBeInTheDocument();
    expect(document.querySelector('svg.text-green-500')).toBeTruthy();
  });
});
