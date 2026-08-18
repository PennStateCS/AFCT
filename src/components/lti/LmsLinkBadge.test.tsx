/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LmsLinkBadge } from './LmsLinkBadge';

describe('LmsLinkBadge', () => {
  it('renders nothing when nothing is linked, so callers need no condition of their own', () => {
    const { container } = render(<LmsLinkBadge links={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('carries the LMS course names in its accessible name, not only the tooltip', () => {
    render(<LmsLinkBadge links={[{ platform: 'Canvas', context: 'CMPSC 464 Fall 2026' }]} />);

    expect(
      screen.getByLabelText('In Canvas: CMPSC 464 Fall 2026 in Canvas'),
    ).toBeInTheDocument();
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
