/** @vitest-environment jsdom */

import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { RichDescription } from './RichDescription';

const globalWithReact = globalThis as typeof globalThis & { React?: typeof React };
globalWithReact.React = React;

const heading = (level: number, value: string) => ({
  type: 'heading',
  attrs: { level },
  content: [{ type: 'text', text: value }],
});

/** All three authored levels, so relative hierarchy is observable rather than assumed. */
const outline = {
  version: 1,
  document: { type: 'doc', content: [heading(2, 'top'), heading(3, 'middle'), heading(4, 'deep')] },
};

function levelsOf(container: HTMLElement): string[] {
  return [...container.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(
    (el) => `${el.tagName}:${el.textContent}`,
  );
}

describe('RichDescription heading levels', () => {
  it('defaults to starting at h2, matching the previous behaviour', () => {
    const { container } = render(<RichDescription descriptionJson={outline} />);
    expect(levelsOf(container)).toEqual(['H2:top', 'H3:middle', 'H4:deep']);
  });

  it('shifts the whole outline down while preserving relative hierarchy', () => {
    const { container } = render(
      <RichDescription descriptionJson={outline} headingBaseLevel={3} />,
    );
    expect(levelsOf(container)).toEqual(['H3:top', 'H4:middle', 'H5:deep']);
  });

  it('supports the deepest usable base without producing an invalid tag', () => {
    const { container } = render(
      <RichDescription descriptionJson={outline} headingBaseLevel={6} />,
    );
    // Everything collapses onto h6 rather than inventing h7/h8.
    expect(levelsOf(container)).toEqual(['H6:top', 'H6:middle', 'H6:deep']);
  });

  it('never emits an h1, whatever the caller asks for', () => {
    for (const base of [-5, 0, 1]) {
      const { container } = render(
        <RichDescription descriptionJson={outline} headingBaseLevel={base} />,
      );
      expect(container.querySelector('h1')).toBeNull();
      expect(levelsOf(container)[0]).toBe('H2:top');
    }
  });

  it('ignores a nonsense base level instead of throwing', () => {
    for (const base of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const { container } = render(
        <RichDescription descriptionJson={outline} headingBaseLevel={base} />,
      );
      expect(container.querySelector('h1')).toBeNull();
      expect(container.querySelectorAll('h2,h3,h4,h5,h6').length).toBe(3);
    }
  });

  it('rounds a fractional base rather than emitting a fractional tag', () => {
    const { container } = render(
      <RichDescription descriptionJson={outline} headingBaseLevel={3.4} />,
    );
    expect(levelsOf(container)[0]).toBe('H3:top');
  });
});

/**
 * The levels each real surface passes. These are derived from the heading that actually precedes
 * the description there, so if someone changes a dialog title or a CardTitle level, this is the
 * test that should make them reconsider the base rather than silently producing a broken outline.
 */
describe('surface heading choices', () => {
  const surfaces = [
    { name: 'student assignment description (under the h2 "Description")', base: 3, first: 'H3' },
    { name: 'problem header (under an aria-level 3 CardTitle)', base: 4, first: 'H4' },
    { name: 'description dialogs (under the h2 DialogTitle)', base: 3, first: 'H3' },
  ];

  it.each(surfaces)('$name starts at $first', ({ base, first }) => {
    const { container } = render(
      <RichDescription descriptionJson={outline} headingBaseLevel={base} />,
    );
    expect(levelsOf(container)[0]?.split(':')[0]).toBe(first);
    expect(container.querySelector('h1')).toBeNull();
  });
});
