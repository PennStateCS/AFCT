/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import katex from 'katex';

import { EquationDialog } from './EquationDialog';
import { describeLatexError } from './latex-error';
import { KATEX_VALIDATION_OPTIONS } from '@/lib/rich-description';

const globalWithReact = globalThis as typeof globalThis & { React?: typeof React };
globalWithReact.React = React;

/**
 * A chainable editor stub that records the maths commands it is asked to run. Enough to prove
 * what the dialog would have written, without standing up a real ProseMirror document.
 */
function recordingEditor() {
  const calls: Array<{ command: string; args: unknown }> = [];
  const chain: Record<string, (...a: unknown[]) => unknown> = {};
  for (const command of [
    'focus',
    'insertInlineMath',
    'insertBlockMath',
    'updateInlineMath',
    'updateBlockMath',
    'deleteInlineMath',
    'deleteBlockMath',
  ]) {
    chain[command] = (args: unknown) => {
      if (command !== 'focus') calls.push({ command, args });
      return chain;
    };
  }
  chain.run = () => true;
  return { editor: { chain: () => chain } as never, calls };
}

function renderDialog(overrides: Partial<React.ComponentProps<typeof EquationDialog>> = {}) {
  const { editor, calls } = recordingEditor();
  const onOpenChange = vi.fn();
  render(
    <EquationDialog
      editor={editor}
      open
      onOpenChange={onOpenChange}
      target={null}
      {...overrides}
    />,
  );
  return { calls, onOpenChange };
}

const field = () => screen.getByLabelText('LaTeX') as HTMLTextAreaElement;
const saveButton = () =>
  screen.queryByRole('button', { name: 'Save equation' }) ??
  screen.getByRole('button', { name: 'Update equation' });

describe('the worked example', () => {
  /**
   * The field starts genuinely empty. It used to carry the example as a placeholder, which sat
   * in the same monospace face as real input: test users read it as something they had already
   * typed and could not work out why the preview stayed blank. The example still exists, in
   * prose, where nothing about it looks like field content.
   */
  it('leaves the input empty rather than pre-filling it with something that looks typed', () => {
    renderDialog();
    expect(field()).toHaveValue('');
    expect(field().getAttribute('placeholder')).toBeNull();
  });

  it('shows the example in the description, as real LaTeX with a single backslash', () => {
    renderDialog();
    // Written as JSX text, which does NOT process backslash escapes the way a JavaScript string
    // literal would. Doubling the backslash in the source would show the reader two of them, and
    // a bare `\f` would be a form feed. This asserts what the DOM actually contains.
    const example = screen.getByText(/\\frac/).textContent!;

    expect(example).toContain('\\frac{n(n-1)}{2}');
    expect(example).not.toContain('\f'); // no form feed
    // And it is LaTeX a professor could actually paste in.
    expect(() =>
      katex.renderToString('\\frac{n(n-1)}{2}', { ...KATEX_VALIDATION_OPTIONS }),
    ).not.toThrow();
  });

  it('says why the preview is blank instead of showing an unexplained empty box', () => {
    renderDialog();
    expect(screen.getByText('Your equation will appear here.')).toBeInTheDocument();
  });
});

/**
 * The race: the preview validates in an effect and stores the result in state. Between changing
 * the source and that effect running, `error` still describes the PREVIOUS expression. Trusting
 * it at submit let a newly invalid equation through, because the old check was only non-empty
 * plus length.
 */
describe('submission validates the current value, not stale state', () => {
  it('refuses an expression that became invalid immediately before submitting', () => {
    const { calls, onOpenChange } = renderDialog();

    // Establish a VALID expression and let the effect settle, so `error` is null.
    fireEvent.change(field(), { target: { value: 'x^2' } });
    expect(saveButton()).toBeEnabled();

    // Now break it and submit in the same tick, before the effect can re-run.
    fireEvent.change(field(), { target: { value: '\\frac{1' } });
    fireEvent.submit(field().closest('form')!);

    // Nothing was written, and the dialog stayed open.
    expect(calls).toEqual([]);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('still saves a valid expression submitted the same way', () => {
    const { calls, onOpenChange } = renderDialog();

    fireEvent.change(field(), { target: { value: '\\frac{n(n-1)}{2}' } });
    fireEvent.submit(field().closest('form')!);

    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('insertInlineMath');
    expect(calls[0].args).toMatchObject({ latex: '\\frac{n(n-1)}{2}' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('normalizes surrounding whitespace before writing', () => {
    const { calls } = renderDialog();
    fireEvent.change(field(), { target: { value: '   x^2   ' } });
    fireEvent.submit(field().closest('form')!);
    expect(calls[0].args).toMatchObject({ latex: 'x^2' });
  });
});

describe('save availability', () => {
  it('is unavailable for an untouched empty field, with no error shown', () => {
    renderDialog();
    expect(saveButton()).toBeDisabled();
    // Nothing has gone wrong yet, so nothing is complained about.
    expect(field()).not.toHaveAttribute('aria-invalid');
  });

  it('treats whitespace-only input as empty', () => {
    renderDialog();
    fireEvent.change(field(), { target: { value: '    ' } });
    expect(saveButton()).toBeDisabled();
  });

  it('is available for a valid expression', () => {
    renderDialog();
    fireEvent.change(field(), { target: { value: '\\Sigma^*' } });
    expect(saveButton()).toBeEnabled();
  });

  it('is unavailable for an invalid expression, with an error shown', () => {
    renderDialog();
    fireEvent.change(field(), { target: { value: '\\frac{1' } });
    expect(saveButton()).toBeDisabled();
    expect(field()).toHaveAttribute('aria-invalid', 'true');
  });

  it('is available immediately when editing an existing valid equation', () => {
    renderDialog({ target: { mode: 'inline', latex: 'x^2', pos: 3 } });
    expect(screen.getByRole('button', { name: 'Update equation' })).toBeEnabled();
  });

  it('reports the empty case only once the user tries to submit', () => {
    renderDialog();
    fireEvent.submit(field().closest('form')!);
    expect(screen.getAllByText(/enter a latex expression/i).length).toBeGreaterThan(0);
  });
});

/**
 * The friendly mapper reads KaTeX's wording, so it is tested against exceptions the INSTALLED
 * KaTeX actually throws rather than hand-written strings that could drift from reality.
 */
describe('friendly errors, driven by real KaTeX exceptions', () => {
  function realError(source: string): unknown {
    try {
      katex.renderToString(source, { ...KATEX_VALIDATION_OPTIONS });
      throw new Error(`expected ${source} to be rejected by KaTeX`);
    } catch (cause) {
      return cause;
    }
  }

  const cases: Array<[string, string, RegExp]> = [
    ['unknown command', '\\notarealcommand', /not one AFCT can draw|mistyped|brace/i],
    ['extra closing brace', 'x^2}', /extra|remove/i],
    ['missing closing brace', '\\frac{1', /brace|closed|mistyped/i],
    ['double superscript', 'x^2^3', /two superscripts|combine/i],
    ['double subscript', 'x_1_2', /two subscripts|combine/i],
    ['incomplete command', '\\sqrt', /braces|mistyped|brace/i],
  ];

  it.each(cases)('maps a real %s into guidance', (_label, source, pattern) => {
    const described = describeLatexError(realError(source));
    expect(described.message).toMatch(pattern);
    // Never empty, never the raw object.
    expect(described.message.length).toBeGreaterThan(0);
    expect(described.message).not.toContain('object Object');
  });

  it('falls back generically for a message it does not recognise', () => {
    const described = describeLatexError(new Error('KaTeX parse error: something brand new'));
    expect(described.message).toMatch(/mistyped command|brace/i);
    expect(described.detail).toBe('something brand new');
  });

  it('handles a non-Error thrown value', () => {
    for (const thrown of [undefined, null, 42, {}, [], 'plain string']) {
      const described = describeLatexError(thrown);
      expect(described.message.length).toBeGreaterThan(0);
      expect(described.message).not.toContain('object Object');
    }
  });

  it('never renders the KaTeX detail as HTML', () => {
    renderDialog();
    // KaTeX echoes the offending source into its message, so the detail can contain markup.
    fireEvent.change(field(), { target: { value: '\\notacommand<img src=x onerror=alert(1)>' } });

    const described = field().getAttribute('aria-describedby');
    const errorNode = document.getElementById(described!)!;
    // Rendered as text: no element was created from the message.
    expect(errorNode.querySelector('img')).toBeNull();
    expect(errorNode.innerHTML).not.toContain('<img');
  });
});
