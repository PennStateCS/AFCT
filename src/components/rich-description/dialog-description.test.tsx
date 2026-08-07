/** @vitest-environment jsdom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { RichDescription } from './RichDescription';

const globalWithReact = globalThis as typeof globalThis & { React?: typeof React };
globalWithReact.React = React;

/**
 * Rich block content cannot live inside a paragraph, and DialogDescription renders one by
 * default. The fix is `asChild` rather than dropping the component: the dialog must stay
 * described. These tests use the REAL Radix dialog, not the shared mock, because the whole point
 * is the aria-describedby wiring that the mock does not reproduce.
 */
const richDoc = {
  version: 1,
  document: {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Requirements' }] },
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first' }] }],
          },
        ],
      },
    ],
  },
};

function renderDialog() {
  render(
    <Dialog open>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Problem Description</DialogTitle>
        </DialogHeader>
        <DialogDescription asChild>
          <div>
            <RichDescription description="plain" descriptionJson={richDoc} />
          </div>
        </DialogDescription>
      </DialogContent>
    </Dialog>,
  );
}

describe('rich description inside a dialog', () => {
  it('keeps the dialog described by the description element', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog');
    const describedBy = dialog.getAttribute('aria-describedby');

    expect(describedBy).toBeTruthy();
    const description = document.getElementById(describedBy!);
    expect(description).not.toBeNull();
    // The id landed on the div we supplied, not on a discarded paragraph.
    expect(description!.tagName).toBe('DIV');
    expect(description!.textContent).toContain('Requirements');
  });

  it('renders block content without nesting it inside a paragraph', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog');
    // Scope to the description itself: DialogTitle is itself an h2, so a dialog-wide query would
    // match the title first.
    const description = document.getElementById(dialog.getAttribute('aria-describedby')!)!;

    expect(description.querySelector('h2')?.textContent).toBe('Requirements');
    expect(description.querySelector('ul li')?.textContent).toBe('first');
    // Invalid nesting would put block elements inside a <p>; there must be no such paragraph.
    expect(dialog.querySelector('p h2')).toBeNull();
    expect(dialog.querySelector('p ul')).toBeNull();
  });

  it('never emits an h1 that would compete with the page', () => {
    renderDialog();
    expect(document.querySelector('h1')).toBeNull();
    // The dialog title is an h2 and description headings are its siblings at h2-h4, which is a
    // valid outline. The policy that matters is that a description cannot reach h1.
    const description = document.getElementById(
      screen.getByRole('dialog').getAttribute('aria-describedby')!,
    )!;
    const levels = Array.from(description.querySelectorAll('h1,h2,h3,h4,h5,h6')).map(
      (heading) => heading.tagName,
    );
    expect(levels.every((tag) => ['H2', 'H3', 'H4'].includes(tag))).toBe(true);
  });

  it('still exposes an accessible name and description together', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleName('Problem Description');
    expect(dialog).toHaveAccessibleDescription(/Requirements/);
  });
});
