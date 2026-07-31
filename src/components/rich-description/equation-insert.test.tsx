/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeAll } from 'vitest';

import { RichDescriptionField } from './RichDescriptionField';
import { warmRichDescriptionEditor, WARM_TIMEOUT_MS } from '@/test/rich-editor';
import {
  BLOCK_MATH_NODE,
  INLINE_MATH_NODE,
  richDescriptionToPlainText,
  validateRichDescription,
} from '@/lib/rich-description';

const globalWithReact = globalThis as typeof globalThis & { React?: typeof React };
globalWithReact.React = React;

/**
 * The whole path a professor takes to add an equation: toolbar button, dialog, insert, and the
 * value the surrounding form would then save.
 *
 * Written after an equation went missing between saving an assignment and reopening it. The cause
 * turned out to be a broken dev build rather than this code, but nothing covered the link between
 * the dialog and the value a form receives, so a real break here would have looked identical.
 */
async function insertEquation(latex: string, placement?: 'Display') {
  fireEvent.click(screen.getByRole('button', { name: 'Insert equation' }));
  fireEvent.change(await screen.findByLabelText(/latex/i), { target: { value: latex } });
  if (placement) fireEvent.click(screen.getByRole('radio', { name: placement }));
  fireEvent.click(screen.getByRole('button', { name: 'Save equation' }));
}

describe('inserting an equation through the description field', () => {
  beforeAll(warmRichDescriptionEditor, WARM_TIMEOUT_MS);

  it('puts the equation in the document the form would save', async () => {
    const onChange = vi.fn();
    render(<RichDescriptionField label="Description" value="Body text" onChange={onChange} />);
    await screen.findByRole('textbox');

    await insertEquation('n^2');

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const saved = onChange.mock.calls.at(-1)![0];

    // Valid against the schema the write path enforces, or the API rejects the save.
    const validated = validateRichDescription(saved);
    expect(validated.ok).toBe(true);
    expect(JSON.stringify(saved)).toContain(INLINE_MATH_NODE);
    // The derived plain text keeps the source, so even a plain-text fallback shows the equation.
    expect(richDescriptionToPlainText(saved)).toContain('$n^2$');
    expect(richDescriptionToPlainText(saved)).toContain('Body text');
  });

  it('keeps a display equation as its own block', async () => {
    const onChange = vi.fn();
    render(<RichDescriptionField label="Description" value="Body text" onChange={onChange} />);
    await screen.findByRole('textbox');

    await insertEquation('\\frac{n(n-1)}{2}', 'Display');

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const saved = onChange.mock.calls.at(-1)![0];
    expect(JSON.stringify(saved)).toContain(BLOCK_MATH_NODE);
    expect(richDescriptionToPlainText(saved)).toContain('$$\\frac{n(n-1)}{2}$$');
  });
});
