/** @vitest-environment jsdom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

import { SearchableMultiSelect } from './SearchableMultiSelect';

// Render the popover panel inline (always open) so the search box and checkbox
// group are queryable without driving the real Radix open/portal machinery.
vi.mock('@/components/ui/popover', () => {
  const Stub = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;
  return {
    Popover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    PopoverTrigger: Stub,
    PopoverContent: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="popover-content">{children}</div>
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

  // A comma-joined list of long names is wider than the control, so it was truncated to
  // the first name plus noise, which hid how many were selected and blew out the layout.
  it('summarises the count past two, rather than listing every name', () => {
    render(
      <SearchableMultiSelect
        label="Faculty"
        items={facultyItems}
        value={['ada', 'alan', 'grace']}
        onChange={() => {}}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Faculty' });
    expect(trigger).toHaveTextContent('3 selected');
    expect(trigger).not.toHaveTextContent('Ada Lovelace');
  });

  it('ignores selected ids that are no longer in the list when counting', () => {
    render(
      <SearchableMultiSelect
        label="Faculty"
        items={facultyItems}
        value={['ada', 'alan', 'deleted-1', 'deleted-2']}
        onChange={() => {}}
      />,
    );

    // Two real matches, so it still lists them rather than claiming four.
    expect(screen.getByRole('button', { name: 'Faculty' })).toHaveTextContent(
      'Ada Lovelace, Alan Turing',
    );
  });

  it('groups the options as checkboxes rather than a menu', () => {
    render(
      <SearchableMultiSelect
        label="Faculty"
        items={facultyItems}
        value={['ada']}
        onChange={() => {}}
      />,
    );

    // The options live in a labelled group of checkboxes, not a menu.
    const group = screen.getByRole('group', { name: 'Faculty' });
    expect(group).toBeInTheDocument();
    expect(screen.queryByRole('menu')).toBeNull();

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(facultyItems.length);
    // The selected item carries its own checked state.
    expect(screen.getByRole('checkbox', { name: 'Ada Lovelace' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Alan Turing' })).not.toBeChecked();
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

describe('SearchableMultiSelect: telling two identical names apart', () => {
  // Reported by Jeff: two members of staff with the same name, and a list of bare names asks
  // whoever is assigning a course to guess which is which.
  const twins = [
    { id: 'b1', label: 'Bruce Wayne', description: 'bwayne@example.edu' },
    { id: 'b2', label: 'Bruce Wayne', description: 'bruce.wayne@example.edu' },
    { id: 'c1', label: 'Clark Kent', description: 'ckent@example.edu' },
  ];

  it('shows the second line under each name', () => {
    render(
      <SearchableMultiSelect label="Assign Faculty" items={twins} value={[]} onChange={vi.fn()} />,
    );
    expect(screen.getByText('bwayne@example.edu')).toBeInTheDocument();
    expect(screen.getByText('bruce.wayne@example.edu')).toBeInTheDocument();
  });

  it('names each option by both, so a screen reader can tell them apart too', () => {
    render(
      <SearchableMultiSelect label="Assign Faculty" items={twins} value={[]} onChange={vi.fn()} />,
    );
    expect(
      screen.getByRole('checkbox', { name: 'Bruce Wayne (bwayne@example.edu)' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: 'Bruce Wayne (bruce.wayne@example.edu)' }),
    ).toBeInTheDocument();
  });

  it('searches the second line as well as the name', async () => {
    const user = userEvent.setup();
    render(
      <SearchableMultiSelect label="Assign Faculty" items={twins} value={[]} onChange={vi.fn()} />,
    );

    await user.type(screen.getByLabelText('Search...'), 'bruce.wayne@');

    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(
      screen.getByRole('checkbox', { name: 'Bruce Wayne (bruce.wayne@example.edu)' }),
    ).toBeInTheDocument();
  });

  it('leaves an item with no second line exactly as it was', () => {
    render(
      <SearchableMultiSelect
        label="Assign Faculty"
        items={facultyItems}
        value={[]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('checkbox', { name: 'Ada Lovelace' })).toBeInTheDocument();
  });
});
