/** @vitest-environment jsdom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { AudienceSelect } from './AudienceSelect';

const items = [
  { id: 'a', label: 'Alice' },
  { id: 'b', label: 'Bob' },
  { id: 'c', label: 'Carol' },
];

const renderSelect = (value: string[], onChange = vi.fn()) => {
  render(
    <AudienceSelect
      label="Students"
      items={items}
      value={value}
      onChange={onChange}
      allLabel="All students"
      addLabel="Add student"
    />,
  );
  return onChange;
};

describe('AudienceSelect', () => {
  it('collapses to the all-label when everything is selected', () => {
    renderSelect(['a', 'b', 'c']);
    expect(screen.getByText('All students')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull();
  });

  it('lists selected members as removable chips when some are excluded', async () => {
    const user = userEvent.setup();
    const onChange = renderSelect(['a', 'b']);

    expect(screen.queryByText('All students')).toBeNull();
    expect(screen.getByText('Alice')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove Alice' }));
    expect(onChange).toHaveBeenCalledWith(['b']);
  });

  it('shows an empty-selection message when nothing is selected', () => {
    renderSelect([]);
    expect(screen.getByText('None selected')).toBeInTheDocument();
  });
});
