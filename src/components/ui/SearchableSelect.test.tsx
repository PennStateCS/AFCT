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
});
