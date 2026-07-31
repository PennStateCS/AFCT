/** @vitest-environment jsdom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeAll } from 'vitest';

import { RichDescriptionField } from './RichDescriptionField';
import { warmRichDescriptionEditor, WARM_TIMEOUT_MS } from '@/test/rich-editor';

const globalWithReact = globalThis as typeof globalThis & { React?: typeof React };
globalWithReact.React = React;

/**
 * The editor is loaded on demand rather than imported, to keep ProseMirror, Tiptap and KaTeX off
 * the routes students read. That is a real seam with a real failure mode: if the dynamic import
 * breaks, nothing throws at build time and no other test notices, because every other editor test
 * imports the component directly. Staff would just find a form with no editor in it.
 *
 * So these tests go through the field, the way the app does.
 */
describe('RichDescriptionField', () => {
  beforeAll(warmRichDescriptionEditor, WARM_TIMEOUT_MS);

  it('loads the editor and gives it the field label', async () => {
    render(<RichDescriptionField label="Description" onChange={vi.fn()} />);

    const editor = await screen.findByRole('textbox');
    expect(editor.getAttribute('aria-labelledby')).toBe(
      screen.getByText('Description').getAttribute('id'),
    );
  });

  it('shows the stored content once the editor arrives', async () => {
    render(<RichDescriptionField label="Description" value="already written" onChange={vi.fn()} />);

    const editor = await screen.findByRole('textbox');
    expect(editor.textContent).toContain('already written');
  });

  it('points the editor at the error message when there is one', async () => {
    render(<RichDescriptionField label="Description" error="Required." onChange={vi.fn()} />);

    const editor = await screen.findByRole('textbox');
    const alert = screen.getByRole('alert');
    expect(editor.getAttribute('aria-describedby')).toBe(alert.getAttribute('id'));
  });
});
