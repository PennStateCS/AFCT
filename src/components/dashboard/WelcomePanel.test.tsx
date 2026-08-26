/** @vitest-environment jsdom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { WelcomePanel } from './WelcomePanel';

describe('WelcomePanel', () => {
  it('greets with the wording the page resolved, by name', () => {
    render(
      <WelcomePanel
        greeting="Good morning"
        firstName="Charles"
        courseSummary="2 current courses"
        assignmentSummary="5 upcoming assignments"
      />,
    );
    const heading = screen.getByRole('heading', { level: 1 });
    // The greeting is the page's, not this component's: it depends on the reader's timezone,
    // which a server component cannot get from its own clock. See lib/greeting.
    expect(heading).toHaveTextContent('Good morning, Charles');
    expect(screen.getByText('2 current courses')).toBeInTheDocument();
    expect(screen.getByText('5 upcoming assignments')).toBeInTheDocument();
  });

  it('drops the name rather than the greeting when there is no name', () => {
    // The page resolves the name and is allowed to hand over an empty string. Rendering
    // "Good morning, " with a dangling comma is the failure this guards.
    render(
      <WelcomePanel
        greeting="Good morning"
        firstName=""
        courseSummary="1 current course"
        assignmentSummary="No upcoming assignments"
      />,
    );
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Good morning');
    expect(heading.textContent).not.toContain(',');
  });

  it('renders whatever wording the page composed, including the zero states', () => {
    // Pluralisation belongs to the page, which is where the counts are. The panel must not
    // second-guess it: these strings go through verbatim.
    render(
      <WelcomePanel
        greeting="Good morning"
        firstName="Ada"
        courseSummary="0 current courses"
        assignmentSummary="No upcoming assignments"
      />,
    );
    expect(screen.getByText('0 current courses')).toBeInTheDocument();
    expect(screen.getByText('No upcoming assignments')).toBeInTheDocument();
  });

  it('keeps the decoration out of the accessibility tree', () => {
    const { container } = render(
      <WelcomePanel
        greeting="Good morning"
        firstName="Ada"
        courseSummary="1 current course"
        assignmentSummary="No upcoming assignments"
      />,
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
      <WelcomePanel
        greeting="Good morning"
        firstName="Ada"
        courseSummary="1 current course"
        assignmentSummary="x"
      />,
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
