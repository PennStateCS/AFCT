/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { Tabs } from '@/components/ui/tabs';
import { TabBar } from './course-tabs';
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
