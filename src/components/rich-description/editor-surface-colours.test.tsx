/** @vitest-environment jsdom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { Input } from '@/components/ui/input';
import { RichDescriptionEditor } from './RichDescriptionEditor';

const globalWithReact = globalThis as typeof globalThis & { React?: typeof React };
globalWithReact.React = React;

/**
 * The editor's own surface, against the fields it sits beside.
 *
 * jsdom applies no stylesheet, so these read classes rather than pixels. That is enough for
 * the failure they exist for: the editor was written to mirror the Textarea's chrome, the
 * shared field controls later moved from a transparent fill to `bg-card`, and the editor was
 * not brought along. Nothing broke, so nothing caught it; on the assignment Details tab a
 * white Title field sat directly above a description box showing the page through itself,
 * which reads as a control that has been greyed out.
 *
 * Comparing against a real Input rather than asserting a literal is the point: if the field
 * surface moves again, this fails and says so instead of quietly pinning the old answer.
 */
function surfaceClass(el: Element) {
  return el.className
    .split(/\s+/)
    .filter((c) => /^(bg-|dark:bg-)/.test(c))
    .join(' ');
}

describe('the editor sits on the same surface as a field', () => {
  it('fills its box the way an Input does', async () => {
    // Unmounted before the editor goes up: both are textboxes, and two on screen at once
    // makes every role query in this test ambiguous.
    const field = render(<Input />);
    const fieldSurface = surfaceClass(field.container.querySelector('input')!);
    field.unmount();

    render(<RichDescriptionEditor showToolbar ariaLabel="Description" value="Some text" />);
    await screen.findByRole('textbox');
    const box = document.querySelector('[data-slot="rich-description-editor"]')!;

    expect(fieldSurface).toContain('bg-card');
    expect(surfaceClass(box)).toBe(fieldSurface);
  });

  /*
   * The toolbar is chrome, not part of the page. Left unfilled on a filled box it read as the
   * top of the document area, so the first thing under the label looked like a row of buttons
   * floating in the text. --muted is one step off --card in all three themes, which is why the
   * same class works in each.
   */
  it('gives the toolbar its own band over that surface', async () => {
    render(<RichDescriptionEditor showToolbar ariaLabel="Description" value="Some text" />);
    await screen.findByRole('textbox');

    const toolbar = document.querySelector('[data-slot="rich-description-editor"] .border-b')!;
    expect(surfaceClass(toolbar)).toBe('bg-muted');
  });

  // Disabled and read-only have to keep overriding the fill, or they become invisible states.
  it.each([
    ['disabled', { disabled: true }, 'bg-accent'],
    ['read-only', { readOnly: true }, 'bg-muted'],
  ])('still marks %s with its own fill', async (_name, props, expected) => {
    render(
      <RichDescriptionEditor showToolbar ariaLabel="Description" value="Some text" {...props} />,
    );
    await screen.findByRole('textbox');

    const box = document.querySelector('[data-slot="rich-description-editor"]')!;
    expect(box.className).toContain(expected);
  });
});
