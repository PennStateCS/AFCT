/** @vitest-environment jsdom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SearchableSelect } from './SearchableSelect';

const items = [
  { id: 'a', label: 'Alpha' },
  { id: 'b', label: 'Beta' },
  { id: 'c', label: 'Gamma' },
];

describe('SearchableSelect', () => {
  it('opens and renders options as buttons, not a listbox', async () => {
    const user = userEvent.setup();
    render(<SearchableSelect label="Add" items={items} onSelect={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Add' }));

    // The options are plain buttons in a labeled group; no listbox/option roles.
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.queryByRole('option')).toBeNull();
    expect(screen.getByRole('button', { name: 'Alpha' })).toBeInTheDocument();
  });

  it('picks the first match when Enter is pressed in the search box', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<SearchableSelect label="Add" items={items} onSelect={onSelect} />);

    await user.click(screen.getByRole('button', { name: 'Add' }));
    const search = await screen.findByLabelText('Search...');
    await user.type(search, 'bet');
    await user.keyboard('{Enter}');

    expect(onSelect).toHaveBeenCalledWith('b');
  });

  it('moves focus to the first option on ArrowDown from the search box', async () => {
    const user = userEvent.setup();
    render(<SearchableSelect label="Add" items={items} onSelect={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Add' }));
    const search = await screen.findByLabelText('Search...');
    search.focus();
    await user.keyboard('{ArrowDown}');

    expect(screen.getByRole('button', { name: 'Alpha' })).toHaveFocus();
  });

  it('takes no input when disabled', () => {
    render(
      <SearchableSelect
        label="Add a student"
        items={items}
        onSelect={() => {}}
        placeholder="Add a student"
        disabled
      />,
    );

    expect(screen.getByRole('button', { name: 'Add a student' })).toBeDisabled();
  });
});

describe('SearchableSelect: telling two identical names apart', () => {
  const twins = [
    { id: 's1', label: 'Bruce Wayne', description: 'bwayne@example.edu' },
    { id: 's2', label: 'Bruce Wayne', description: 'bruce.wayne@example.edu' },
  ];

  it('names each option by both, and searches the second line', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<SearchableSelect label="Add override" items={twins} onSelect={onSelect} />);
    await user.click(screen.getByRole('button', { name: 'Add override' }));

    expect(screen.getByText('bwayne@example.edu')).toBeInTheDocument();

    await user.type(screen.getByRole('textbox'), 'bruce.wayne@');
    const options = screen.getAllByRole('button', { name: /Bruce Wayne/ });
    expect(options).toHaveLength(1);

    await user.click(options[0]!);
    expect(onSelect).toHaveBeenCalledWith('s2');
  });
});
