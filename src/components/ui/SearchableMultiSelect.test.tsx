/** @vitest-environment jsdom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

import { SearchableMultiSelect } from './SearchableMultiSelect';

vi.mock('@/components/ui/dropdown-menu', () => {
  const Stub = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;
  return {
    DropdownMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    DropdownMenuTrigger: Stub,
    DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="dropdown-content">{children}</div>
    ),
  };
});

const facultyItems = [
  { id: 'ada', label: 'Ada Lovelace' },
  { id: 'alan', label: 'Alan Turing' },
  { id: 'grace', label: 'Grace Hopper' },
];

describe('SearchableMultiSelect', () => {
  it('links the label and error text to the trigger button', () => {
    render(
      <SearchableMultiSelect
        label="Assign Faculty"
        id="faculty-select"
        items={facultyItems}
        value={[]}
        onChange={() => {}}
        placeholder="Select instructors"
        error="Please select at least one instructor"
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Assign Faculty' });

    expect(trigger).toHaveAttribute('id', 'faculty-select');
    expect(trigger).toHaveAttribute('aria-invalid', 'true');
    expect(trigger).toHaveAttribute('aria-describedby', 'faculty-select-error');
    expect(trigger).toHaveTextContent('Select instructors');
    expect(screen.getByText('Please select at least one instructor')).toHaveAttribute(
      'id',
      'faculty-select-error',
    );
  });

  it('filters items based on the search query and shows the empty state message', async () => {
    const user = userEvent.setup();

    render(
      <SearchableMultiSelect
        label="Faculty"
        items={facultyItems}
        value={[]}
        onChange={() => {}}
        searchPlaceholder="Search faculty..."
        emptyStateText="No faculty found"
      />,
    );

    const searchInput = screen.getByPlaceholderText('Search faculty...');

    await user.type(searchInput, 'ada');
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.queryByText('Alan Turing')).not.toBeInTheDocument();

    await user.clear(searchInput);
    await user.type(searchInput, 'zzz');
    expect(screen.getByText('No faculty found')).toBeInTheDocument();
  });

  it('toggles selections and reports changes through onChange', async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();

    function Harness() {
      const [selected, setSelected] = React.useState<string[]>([]);
      return (
        <SearchableMultiSelect
          label="Faculty"
          items={facultyItems}
          value={selected}
          onChange={(next) => {
            setSelected(next);
            handleChange(next);
          }}
        />
      );
    }

    render(<Harness />);

    const ada = screen.getByLabelText('Ada Lovelace');
    await user.click(ada);
    expect(handleChange).toHaveBeenLastCalledWith(['ada']);

    await user.click(ada);
    expect(handleChange).toHaveBeenLastCalledWith([]);
  });

  it('displays the selected labels inside the trigger button', () => {
    render(
      <SearchableMultiSelect
        label="Faculty"
        items={facultyItems}
        value={['ada', 'alan']}
        onChange={() => {}}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Faculty' });
    expect(trigger).toHaveTextContent('Ada Lovelace, Alan Turing');
  });

  it('respects the disabled state', () => {
    render(
      <SearchableMultiSelect
        label="Faculty"
        items={facultyItems}
        value={[]}
        onChange={() => {}}
        disabled
      />,
    );

    expect(screen.getByRole('button', { name: 'Faculty' })).toBeDisabled();
  });
});
