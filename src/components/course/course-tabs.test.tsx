/** @vitest-environment jsdom */

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { act, waitFor } from '@testing-library/react';
import { Tabs } from '@/components/ui/tabs';
import { COURSE_TABS, CourseTabBar, TabBar, TabRail } from './course-tabs';
import { LOCAL_NAV_COLLAPSED_KEY, LocalNavLayout } from '@/components/local-nav';
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
    const options = within(select)
      .getAllByRole('option')
      .map((o) => o.textContent);
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
      <Tabs
        value="assignments"
        onValueChange={onValueChange}
        orientation={rail ? 'vertical' : 'horizontal'}
      >
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
    // Counted from the list itself: a tab added here should not need a number edited there.
    expect(within(lists[0]).getAllByRole('tab')).toHaveLength(COURSE_TABS.length);
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

/**
 * The rail's collapse behaviour lives in the shared component, so it is tested there
 * rather than through any one page. jsdom applies no CSS, so what these assert is the
 * wiring: which classes and attributes are emitted, what survives the toggle, and what is
 * remembered. Whether 56px actually looks right is a browser question.
 */
describe('TabRail collapse', () => {
  const renderRail = (extra?: React.ReactNode) =>
    render(
      <Tabs value="a" onValueChange={vi.fn()} orientation="vertical">
        <LocalNavLayout
          nav={<TabRail tabs={TABS} ariaLabel="Demo sections" menuLabel="Demo Menu" />}
        >
          {extra ?? <div>panel</div>}
        </LocalNavLayout>
      </Tabs>,
    );

  const collapseButton = () => screen.getByRole('button', { name: 'Collapse demo menu' });
  const expandButton = () => screen.getByRole('button', { name: 'Expand demo menu' });
  const labelSpan = (name: RegExp | string) =>
    within(screen.getByRole('tab', { name })).getByText('Alpha');

  beforeEach(() => {
    window.localStorage.clear();
  });

  it('starts expanded, with a named header, visible labels and a collapse control', () => {
    renderRail();
    // The header names the rail and carries the toggle on the same row, rather than
    // leaving it alone above a blank space.
    expect(screen.getByText('Demo Menu')).toBeInTheDocument();
    expect(collapseButton()).toBeInTheDocument();
    expect(collapseButton()).toHaveAttribute('aria-expanded', 'true');
    // The label is visible text, not screen-reader-only.
    expect(labelSpan('Alpha, 3')).not.toHaveClass('sr-only');
    // The menu name is not an eighth tab.
    expect(screen.getAllByRole('tab')).toHaveLength(3);
  });

  it('renders the rail as one card of full-bleed rows, not a tray of pills', () => {
    const { container } = renderRail();
    const shell = container.querySelector('[data-slot="tabs-list"]')?.parentElement as HTMLElement;
    // The shell owns the surface and the radius; the rows own neither.
    expect(shell.className).toContain('bg-card');
    expect(shell.className).toContain('overflow-hidden');
    expect(shell.className).not.toContain('bg-muted/40');

    const alpha = screen.getByRole('tab', { name: 'Alpha, 3' });
    expect(alpha.className).toContain('rounded-none');
    expect(alpha.className).toContain('h-14');
    // The active row tints across the whole width and marks its left edge with a 3px bar,
    // rather than floating a rounded pill inside a padded panel.
    expect(alpha.className).toContain('data-[state=active]:bg-tab-active-bg');
    expect(alpha.className).toContain('data-[state=active]:before:bg-tab-active');
    // Separators between rows, closed off by the shell's own border at the bottom.
    expect(alpha.className).toContain('border-b');
    expect(alpha.className).toContain('last:border-b-0');
    // The dark active colour comes from --tab-active, not from a blue spelled out here:
    // the rail and the horizontal strip have to stay the same blue.
    expect(alpha.className).not.toMatch(/blue-\d/);
  });

  it('left-aligns every expanded row, whether or not it carries a count', () => {
    renderRail();
    // The base TabsTrigger centres its content, which is right for a horizontal strip and
    // wrong here. Asserted on the MERGED class list, so this covers tailwind-merge actually
    // resolving the conflict rather than both classes surviving.
    for (const name of ['Alpha, 3', 'Bravo', 'Charlie']) {
      const row = screen.getByRole('tab', { name });
      expect(row.className).toContain('justify-start');
      expect(row.className).not.toContain('justify-center');
      // The rail's own icon/label gap, not the strip's.
      expect(row.className).toContain('gap-3');
      expect(row.className).not.toContain('gap-1.5');
    }
  });

  it('centres collapsed rows instead', () => {
    renderRail();
    fireEvent.click(collapseButton());
    const row = screen.getByRole('tab', { name: 'Alpha, 3' });
    expect(row.className).toContain('justify-center');
    expect(row.className).not.toContain('justify-start');
  });

  it('keeps the left marker on the active row while collapsed', () => {
    renderRail();
    fireEvent.click(collapseButton());
    // aria-selected, not data-state: the tooltip wrapper owns data-state here.
    expect(screen.getByRole('tab', { name: 'Alpha, 3' }).className).toContain(
      'aria-selected:before:bg-tab-active',
    );
  });

  it('drops the header label entirely when collapsed', () => {
    renderRail();
    fireEvent.click(collapseButton());
    // Not hidden in place: nothing should reserve width in a 56px rail.
    expect(screen.queryByText('Demo Menu')).toBeNull();
    expect(expandButton()).toBeInTheDocument();
  });

  it('names the toggle after the menu, so no page says the wrong thing', () => {
    render(
      <Tabs value="a" onValueChange={vi.fn()} orientation="vertical">
        <LocalNavLayout
          nav={<TabRail tabs={TABS} ariaLabel="Course sections" menuLabel="Course Menu" />}
        >
          <div>panel</div>
        </LocalNavLayout>
      </Tabs>,
    );
    expect(screen.getByRole('button', { name: 'Collapse course menu' })).toBeInTheDocument();
  });

  it('falls back to a generic menu name rather than borrowing another page name', () => {
    render(
      <Tabs value="a" onValueChange={vi.fn()} orientation="vertical">
        <LocalNavLayout nav={<TabRail tabs={TABS} ariaLabel="Demo sections" />}>
          <div>panel</div>
        </LocalNavLayout>
      </Tabs>,
    );
    expect(screen.getByText('Navigation')).toBeInTheDocument();
    expect(screen.queryByText('Course Menu')).toBeNull();
    expect(screen.getByRole('button', { name: 'Collapse navigation' })).toBeInTheDocument();
  });

  it('hides labels and the count pill when collapsed, keeping icons and names', () => {
    renderRail();
    fireEvent.click(collapseButton());

    // The label stays in the DOM as sr-only: it is what names a tab that has no count.
    expect(labelSpan('Alpha, 3')).toHaveClass('sr-only');
    expect(screen.getByRole('tab', { name: 'Bravo' })).toBeInTheDocument();
    // The count survives in the accessible name even though its pill is gone.
    expect(screen.getByRole('tab', { name: 'Alpha, 3' })).toBeInTheDocument();
    const alpha = screen.getByRole('tab', { name: 'Alpha, 3' });
    expect(within(alpha).queryByText('3')).toBeNull();
    expect(alpha.querySelector('svg')).not.toBeNull();
  });

  it('keeps the active tab visibly active through the toggle', () => {
    renderRail();
    expect(screen.getByRole('tab', { name: 'Alpha, 3' })).toHaveAttribute('data-state', 'active');

    fireEvent.click(collapseButton());
    // A collapsed row is wrapped in a Tooltip trigger, and that overwrites data-state, so
    // the active styling hangs off aria-selected there instead. Without the swap the whole
    // rail reads as inactive while collapsed, which is exactly the bug this pins.
    const alpha = screen.getByRole('tab', { name: 'Alpha, 3' });
    expect(alpha).toHaveAttribute('aria-selected', 'true');
    expect(alpha.className).toContain('aria-selected:bg-tab-active-bg');
    expect(screen.getByRole('tab', { name: 'Bravo' })).toHaveAttribute('aria-selected', 'false');
  });

  it('toggles back with the same control, and keeps focus on it', () => {
    renderRail();
    const button = collapseButton();
    act(() => button.focus());
    fireEvent.click(button);

    // One control in both states, so focus never jumps to the page content.
    expect(expandButton()).toHaveFocus();
    fireEvent.click(expandButton());
    expect(collapseButton()).toHaveFocus();
  });

  it('shows a tooltip naming the item, with its count, only while collapsed', async () => {
    renderRail();
    fireEvent.click(collapseButton());

    // Radix opens on focus as well as hover, which is the path that matters here.
    fireEvent.focus(screen.getByRole('tab', { name: 'Alpha, 3' }));
    await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent('Alpha (3)'));
  });

  it('remembers the choice, and applies it on the next mount', () => {
    const { unmount } = renderRail();
    fireEvent.click(collapseButton());
    expect(window.localStorage.getItem(LOCAL_NAV_COLLAPSED_KEY)).toBe('true');
    unmount();

    renderRail();
    expect(expandButton()).toBeInTheDocument();
    expect(labelSpan('Alpha, 3')).toHaveClass('sr-only');
  });

  it('renders no toggle outside a LocalNavLayout, where nothing could act on it', () => {
    render(
      <Tabs value="a" onValueChange={vi.fn()} orientation="vertical">
        <TabRail tabs={TABS} ariaLabel="Demo sections" menuLabel="Demo Menu" />
      </Tabs>,
    );
    expect(screen.queryByRole('button', { name: /demo menu/i })).toBeNull();
    // The header still names the rail; only the control that could not work is dropped.
    expect(screen.getByText('Demo Menu')).toBeInTheDocument();
    expect(labelSpan('Alpha, 3')).not.toHaveClass('sr-only');
  });
});

describe('LocalNavLayout', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  const layout = () => document.querySelector('[style*="--local-nav-width"]') as HTMLElement;

  it('hands the freed width to the workspace when the rail collapses', () => {
    render(
      <Tabs value="a" onValueChange={vi.fn()} orientation="vertical">
        <LocalNavLayout
          nav={<TabRail tabs={TABS} ariaLabel="Demo sections" menuLabel="Demo Menu" />}
        >
          <div>panel</div>
        </LocalNavLayout>
      </Tabs>,
    );

    // The grid column is driven by this variable, so the rail and the workspace beside it
    // can never disagree about how much room it takes.
    expect(layout().style.getPropertyValue('--local-nav-width')).toBe('15rem');
    fireEvent.click(screen.getByRole('button', { name: 'Collapse demo menu' }));
    expect(layout().style.getPropertyValue('--local-nav-width')).toBe('3.5rem');
  });

  it('animates the column, and stands down for prefers-reduced-motion', () => {
    render(
      <LocalNavLayout nav={<div />}>
        <div>panel</div>
      </LocalNavLayout>,
    );
    expect(layout().className).toContain('xl:transition-[grid-template-columns]');
    expect(layout().className).toContain('xl:motion-reduce:transition-none');
  });
});
