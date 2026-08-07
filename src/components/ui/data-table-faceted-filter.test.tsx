/** @vitest-environment jsdom */

import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DataTableFilterMenu } from './data-table-faceted-filter';

/**
 * The controlled filter menu used by the server-paginated pages. The behaviour worth
 * pinning here is the `sections` option: several headings that remain ONE filter, so a
 * pick from each still widens rather than narrowing to nothing.
 */
describe('DataTableFilterMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Radix popover calls scrollIntoView, which jsdom lacks.
    (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = vi.fn();
  });

  const statusGroup = (selected: string[], onChange: (v: string[]) => void) => ({
    key: 'status',
    label: 'Status',
    sections: [
      {
        label: 'Status',
        options: [
          { label: 'Pending', value: 'pending' },
          { label: 'Failed', value: 'failed' },
        ],
      },
      {
        label: 'Submission',
        options: [
          { label: 'Correct', value: 'correct' },
          { label: 'Incorrect', value: 'incorrect' },
        ],
      },
    ],
    selected,
    onChange,
  });

  it('renders a group as a single labelled block by default', async () => {
    const user = userEvent.setup();
    render(
      <DataTableFilterMenu
        groups={[
          {
            key: 'timing',
            label: 'Timing',
            options: [
              { label: 'On time', value: 'ontime' },
              { label: 'Late', value: 'late' },
            ],
            selected: [],
            onChange: vi.fn(),
          },
        ]}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Filters' }));
    expect(screen.getByRole('group', { name: 'Timing' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'On time' })).toBeInTheDocument();
  });

  it('splits one group across several headings when given sections', async () => {
    const user = userEvent.setup();
    render(<DataTableFilterMenu groups={[statusGroup([], vi.fn())]} />);

    await user.click(screen.getByRole('button', { name: 'Filters' }));

    // Two headings, both reachable as their own labelled group for a screen reader.
    expect(screen.getByRole('group', { name: 'Status' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Submission' })).toBeInTheDocument();
  });

  it('keeps sections as one selection, so a pick from each is preserved', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DataTableFilterMenu groups={[statusGroup(['failed'], onChange)]} />);

    // Named "Filters, N active" once something is picked.
    await user.click(screen.getByRole('button', { name: /^Filters/ }));
    await user.click(screen.getByRole('checkbox', { name: 'Correct' }));

    // Ticking under the second heading ADDS to the first heading's pick rather than
    // replacing it: the five values are one OR-set, so this widens.
    expect(onChange).toHaveBeenCalledWith(expect.arrayContaining(['failed', 'correct']));
  });

  it('counts a sectioned group once, not once per heading', async () => {
    render(<DataTableFilterMenu groups={[statusGroup(['failed', 'correct'], vi.fn())]} />);

    // Two values selected in one group. Rendering the group's checkboxes under two
    // headings must not make the badge read four.
    expect(screen.getByRole('button', { name: 'Filters, 2 active' })).toBeInTheDocument();
  });

  it('clears every group at once', async () => {
    const user = userEvent.setup();
    const onStatus = vi.fn();
    const onTiming = vi.fn();
    render(
      <DataTableFilterMenu
        groups={[
          statusGroup(['failed'], onStatus),
          {
            key: 'timing',
            label: 'Timing',
            options: [{ label: 'Late', value: 'late' }],
            selected: ['late'],
            onChange: onTiming,
          },
        ]}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Filters/ }));
    await user.click(screen.getByRole('button', { name: 'Clear all' }));

    expect(onStatus).toHaveBeenCalledWith([]);
    expect(onTiming).toHaveBeenCalledWith([]);
  });
});
