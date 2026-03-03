/** @vitest-environment jsdom */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { Badge } from './RoleBadge';

describe('RoleBadge', () => {
  it('normalizes role names and applies the matching colors', () => {
    render(<Badge role="faculty" data-testid="badge" />);

    const badge = screen.getByTestId('badge');

    expect(badge).toHaveClass('bg-blue-800', 'text-white');
    expect(badge.textContent?.trim()).toBe('Faculty');
  });

  it('keeps the TA acronym uppercase', () => {
    render(<Badge role="ta" data-testid="badge" />);

    const badge = screen.getByTestId('badge');

    expect(badge).toHaveClass('bg-slate-800', 'text-white');
    expect(badge.textContent?.trim()).toBe('TA');
  });

  it('falls back to the provided variant styles when the role is unknown', () => {
    render(<Badge role="guest" variant="outline" data-testid="badge" />);

    const badge = screen.getByTestId('badge');

    expect(badge).toHaveClass('border-gray-300', 'text-gray-700');
    expect(badge.textContent?.trim()).toBe('');
  });

  it('prefers custom children over derived labels', () => {
    render(
      <Badge role="admin" data-testid="badge">
        Owner
      </Badge>,
    );

    expect(screen.getByText('Owner')).toBeInTheDocument();
  });
});
