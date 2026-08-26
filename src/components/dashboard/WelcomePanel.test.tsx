/** @vitest-environment jsdom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { WelcomePanel } from './WelcomePanel';

describe('WelcomePanel', () => {
  it('greets by name and states the two counts', () => {
    render(
      <WelcomePanel
        firstName="Charles"
        courseSummary="2 current courses"
        assignmentSummary="5 upcoming assignments"
      />,
    );
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Welcome back, Charles');
    expect(screen.getByText(/2 current courses/)).toHaveTextContent(
      '2 current courses · 5 upcoming assignments',
    );
  });

  it('drops the name rather than the greeting when there is no name', () => {
    // The page resolves the name and is allowed to hand over an empty string. Rendering
    // "Welcome back, " with a dangling comma is the failure this guards.
    render(<WelcomePanel firstName="" courseSummary="1 current course" assignmentSummary="" />);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Welcome back');
    expect(heading.textContent).not.toContain(',');
  });

  it('renders whatever wording the page composed, including the zero states', () => {
    // Pluralisation belongs to the page, which is where the counts are. The panel must not
    // second-guess it: these strings go through verbatim.
    render(
      <WelcomePanel
        firstName="Ada"
        courseSummary="0 current courses"
        assignmentSummary="No upcoming assignments"
      />,
    );
    expect(screen.getByText(/0 current courses/)).toHaveTextContent(
      '0 current courses · No upcoming assignments',
    );
  });

  it('keeps the decoration out of the accessibility tree', () => {
    const { container } = render(
      <WelcomePanel firstName="Ada" courseSummary="1 current course" assignmentSummary="" />,
    );
    // Three decorations: the node network, the glow behind the mark, and the mark itself. None
    // of them may be reachable, focusable or clickable.
    const network = container.querySelector('svg.pointer-events-none[aria-hidden="true"]');
    expect(network).not.toBeNull();
    expect(network).toHaveAttribute('focusable', 'false');
    // The shared figure from the course banner, not a second drawing of one.
    expect(network?.querySelectorAll('circle').length).toBeGreaterThan(40);
    expect(container.querySelector('[aria-hidden="true"].rounded-full')).not.toBeNull();
    // The mark is decorative too: the greeting names the page and the sidebar says AFCT.
    expect(container.querySelectorAll('svg[aria-hidden="true"]').length).toBe(2);
    expect(container.querySelectorAll('svg:not([aria-hidden="true"])').length).toBe(0);
  });

  it('takes its colours from the shared banner tokens', () => {
    // The panel is dark in every theme, so a page token in here is a value that follows the
    // page instead: near-black text on navy in light mode, invisible, and no way to see that
    // from the markup. Same rule the course and assignment banners are held to.
    const { container } = render(
      <WelcomePanel firstName="Ada" courseSummary="1 current course" assignmentSummary="x" />,
    );
    const classes = Array.from(container.querySelectorAll<HTMLElement>('[class]'))
      .map((el) => el.getAttribute('class') ?? '')
      .join(' ')
      .split(/\s+/);
    const themed = classes.filter((c) =>
      /(^|:)(text|bg|border)-(foreground|background|card|muted|accent|secondary|primary|popover)(\b|-|\/)/.test(
        c,
      ),
    );
    expect(themed).toEqual([]);
  });
});
