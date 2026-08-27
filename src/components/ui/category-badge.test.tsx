/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CategoryBadge } from './category-badge';

const classOf = (container: HTMLElement) => container.firstElementChild?.className ?? '';

describe('CategoryBadge', () => {
  it('gives each log category its own categorical hue', () => {
    for (const [category, hue] of [
      ['SYSTEM', 'slate'],
      ['USER', 'blue'],
      ['COURSE', 'indigo'],
      ['ASSIGNMENT', 'violet'],
      ['PROBLEM', 'green'],
      ['SUBMISSION', 'orange'],
      ['GRADE', 'fuchsia'],
    ] as const) {
      const { container, unmount } = render(<CategoryBadge category={category} />);
      expect(classOf(container)).toContain(`badge-category-${hue}`);
      unmount();
    }
  });

  /**
   * Grade has twice been the wrong colour: teal, which is the product's own, and then rose,
   * which sat beside the red severity badges and read as one of them.
   */
  it('draws Grade in neither teal nor a red', () => {
    const { container } = render(<CategoryBadge category="GRADE" />);

    expect(classOf(container)).not.toContain('teal');
    expect(classOf(container)).not.toContain('rose');
    expect(classOf(container)).toContain('badge-category-fuchsia');
  });

  it('falls back to a safe hue for a category invented since this map was written', () => {
    const { container } = render(<CategoryBadge category="INTEGRATION" />);

    expect(screen.getByText('INTEGRATION')).toBeInTheDocument();
    expect(classOf(container)).toContain('badge-category-slate');
  });

  it('renders nothing at all when the log entry has no category', () => {
    const { container } = render(<CategoryBadge category={null} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('leaves the label exactly as the log stores it', () => {
    render(<CategoryBadge category="SUBMISSION" />);

    expect(screen.getByText('SUBMISSION')).toBeInTheDocument();
  });
});
