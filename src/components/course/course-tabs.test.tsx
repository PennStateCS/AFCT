/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { Tabs } from '@/components/ui/tabs';
import { CourseTabBar, TabBar } from './course-tabs';
import { BookOpen } from 'lucide-react';

const TABS = [
  { value: 'a', label: 'Alpha', Icon: BookOpen, count: 3 },
  { value: 'b', label: 'Bravo' },
  { value: 'c', label: 'Charlie' },
] as const;

function renderBar(onValueChange = vi.fn(), value = 'a') {
  return render(
    <Tabs value={value} onValueChange={onValueChange}>
      <TabBar
        tabs={TABS}
        value={value}
        onValueChange={onValueChange}
        ariaLabel="Demo sections"
        selectId="demo-select"
      />
    </Tabs>,
  );
}

describe('TabBar', () => {
  it('renders a named tablist with one tab per item', () => {
    renderBar();
    const list = screen.getByRole('tablist', { name: 'Demo sections' });
    expect(within(list).getAllByRole('tab')).toHaveLength(3);
    // A count folds into the tab's accessible name (Label in Name still holds).
    expect(within(list).getByRole('tab', { name: 'Alpha, 3' })).toBeInTheDocument();
    expect(within(list).getByRole('tab', { name: 'Bravo' })).toBeInTheDocument();
  });

  it('renders a labelled mobile select mirroring the tabs, and drives changes', () => {
    const onValueChange = vi.fn();
    renderBar(onValueChange);

    const select = screen.getByRole('combobox', { name: 'Demo sections' });
    const options = within(select).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['Alpha (3)', 'Bravo', 'Charlie']);

    fireEvent.change(select, { target: { value: 'c' } });
    expect(onValueChange).toHaveBeenCalledWith('c');
  });

  it('wires trigger/panel ids only when linkPanels is set', () => {
    const { rerender } = renderBar();
    // Default: no explicit tab-*/panel-* ids (Radix wires its own).
    expect(document.getElementById('tab-a')).toBeNull();

    rerender(
      <Tabs value="a" onValueChange={vi.fn()}>
        <TabBar
          tabs={TABS}
          value="a"
          onValueChange={vi.fn()}
          ariaLabel="Demo sections"
          selectId="demo-select"
          linkPanels
        />
      </Tabs>,
    );
    expect(document.getElementById('tab-a')).not.toBeNull();
    expect(document.getElementById('tab-a')).toHaveAttribute('aria-controls', 'panel-a');
  });
});

describe('CourseTabBar', () => {
  const renderCourseBar = (rail: boolean, onValueChange = vi.fn()) =>
    render(
      <Tabs value="assignments" onValueChange={onValueChange} orientation={rail ? 'vertical' : 'horizontal'}>
        <CourseTabBar
          value="assignments"
          onValueChange={onValueChange}
          rail={rail}
          counts={{ assignments: 2, problems: 13, roster: 20 }}
        />
      </Tabs>,
    );

  /**
   * Exactly one tablist, whichever shape is on screen. Both emit `tab-*` ids that
   * CourseTabPanel points its aria-labelledby at, so rendering the rail and the strip
   * together would duplicate every one of them.
   */
  it('renders the rail as a single tablist carrying the trigger ids', () => {
    renderCourseBar(true);

    const lists = screen.getAllByRole('tablist', { name: 'Course content sections' });
    expect(lists).toHaveLength(1);
    expect(within(lists[0]).getAllByRole('tab')).toHaveLength(7);
    expect(document.querySelectorAll('#tab-assignments')).toHaveLength(1);
    expect(screen.getByRole('tab', { name: 'Assignments, 2' })).toHaveAttribute(
      'aria-controls',
      'panel-assignments',
    );
  });

  it('drives the same value change from a rail item', () => {
    const onValueChange = vi.fn();
    renderCourseBar(true, onValueChange);

    // Radix activates a trigger on mousedown, not click.
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Roster, 20' }));
    expect(onValueChange).toHaveBeenCalledWith('roster');
  });

  it('falls back to the strip and the mobile select when the rail is off', () => {
    renderCourseBar(false);

    // The select is the below-md control, and the rail branch never renders one, so its
    // presence proves which branch ran. Still exactly one tablist either way.
    expect(screen.getByRole('combobox', { name: 'Course content sections' })).toBeInTheDocument();
    expect(screen.getAllByRole('tablist', { name: 'Course content sections' })).toHaveLength(1);
  });
});
