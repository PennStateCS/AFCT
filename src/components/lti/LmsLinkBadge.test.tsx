/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LmsLinkBadge } from './LmsLinkBadge';

describe('LmsLinkBadge', () => {
  it('renders nothing when nothing is linked, so callers need no condition of their own', () => {
    const { container } = render(<LmsLinkBadge links={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  /**
   * As real text rather than an `aria-label`. A Badge is a plain span with no role, and ARIA
   * does not permit a label on a generic element: some assistive tech drops it, taking the
   * course names with it, and some honours it and hides the visible wording instead.
   */
  it('carries the LMS course names as text, not only in the tooltip', () => {
    const { container } = render(
      <LmsLinkBadge links={[{ platform: 'Canvas', context: 'CMPSC 464 Fall 2026' }]} />,
    );

    // The visible short form, and the detail behind it, both readable.
    expect(screen.getByText('In Canvas')).toBeInTheDocument();
    expect(container.textContent).toContain('CMPSC 464 Fall 2026 in Canvas');
    // The label that would have replaced all of it is gone.
    expect(container.querySelector('[aria-label]')).toBeNull();
  });

  it('counts several links rather than repeating one name across the header', () => {
    render(
      <LmsLinkBadge
        links={[
          { platform: 'Canvas', context: 'Section 1' },
          { platform: 'Canvas', context: 'Section 2' },
        ]}
      />,
    );

    expect(screen.getByText('In 2 Canvas courses')).toBeInTheDocument();
  });
});
