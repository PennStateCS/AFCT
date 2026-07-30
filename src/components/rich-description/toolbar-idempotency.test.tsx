/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { RichDescriptionEditor, type RichDescriptionEditorHandle } from './RichDescriptionEditor';
import type { RichDescriptionEnvelope } from '@/lib/rich-description';

const globalWithReact = globalThis as typeof globalThis & { React?: typeof React };
globalWithReact.React = React;

const doc = (...content: unknown[]) =>
  ({ version: 1, document: { type: 'doc', content } }) as unknown as RichDescriptionEnvelope;
const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

async function setup(value = doc(para('hello world'))) {
  const onChange = vi.fn();
  let handle: RichDescriptionEditorHandle | null = null;
  render(
    <RichDescriptionEditor
      value={value}
      showToolbar
      ariaLabel="Description"
      onChange={onChange}
      onReady={(h) => {
        handle = h;
      }}
    />,
  );
  await screen.findByRole('textbox');
  await waitFor(() => expect(handle).not.toBeNull());
  return { onChange, handle: handle as unknown as RichDescriptionEditorHandle };
}

/** The document as the editor currently holds it, for before/after comparison. */
function currentDoc(onChange: ReturnType<typeof vi.fn>): unknown {
  const calls = onChange.mock.calls;
  return calls.length ? calls[calls.length - 1][0].document : null;
}

const toggle = (name: string) => screen.getByRole('button', { name });

/**
 * Whether the document currently carries a mark or node type, read from the emitted JSON rather
 * than from the button's pressed styling. The document is what actually matters, and it avoids
 * depending on when Radix reflects state back into aria-pressed.
 */
function docContains(onChange: ReturnType<typeof vi.fn>, needle: string): boolean {
  return JSON.stringify(currentDoc(onChange) ?? {}).includes(needle);
}

/** Click a toggle and let the editor's transaction settle. */
async function click(name: string) {
  fireEvent.click(toggle(name));
  await waitFor(() => expect(screen.getByRole('textbox')).toBeInTheDocument());
  // Marks settle a beat after the transaction; the editor emits onChange asynchronously.
  await new Promise((resolve) => setTimeout(resolve, 200));
}

/**
 * The handlers now make the document match the REQUESTED state (setBold/unsetBold and friends)
 * rather than blindly toggling. That matters because `onPressedChange` carries the value Radix
 * wants, not a flip instruction, so a duplicate emission of the same value used to reverse the
 * state.
 *
 * A duplicate emission is NOT reachable by clicking: `pressed` is controlled by live editor
 * state, so consecutive clicks emit true then false, which is ordinary toggling. These tests
 * therefore assert the reachable contract (each request produces the requested state, and the
 * content survives the round trip). The duplicate-value case is defensive, and set/unset are
 * idempotent by construction: calling setBold twice leaves bold on.
 */
describe('toggle handlers are idempotent', () => {
  const marks: Array<[string, string]> = [
    ['Bold', 'bold'],
    ['Italic', 'italic'],
    ['Underline', 'underline'],
    ['Inline code', 'code'],
  ];

  it.each(marks)('%s applies and removes cleanly, preserving the text', async (name, mark) => {
    const { onChange, handle } = await setup();
    handle.selectAll();

    await click(name);
    expect(docContains(onChange, `"${mark}"`)).toBe(true);

    await click(name);
    expect(docContains(onChange, `"${mark}"`)).toBe(false);

    // Round-tripping the mark must not disturb the words it wrapped.
    expect(JSON.stringify(currentDoc(onChange))).toContain('hello world');
  });

  it.each(marks)('%s returns to the applied state on a third request', async (name, mark) => {
    const { onChange, handle } = await setup();
    handle.selectAll();

    await click(name);
    await click(name);
    await click(name);
    // Three requests end where one did: on. A handler that had drifted from the editor's state
    // would land somewhere else.
    expect(docContains(onChange, `"${mark}"`)).toBe(true);
  });

  const blocks: Array<[string, string]> = [
    ['Bullet list', 'bulletList'],
    ['Numbered list', 'orderedList'],
    ['Quote', 'blockquote'],
  ];

  it.each(blocks)('%s applies when requested', async (name, node) => {
    const { onChange, handle } = await setup();
    handle.selectAll();

    await click(name);
    expect(docContains(onChange, `"${node}"`)).toBe(true);
  });

  it('preserves the text through a list round trip', async () => {
    const { onChange, handle } = await setup();
    handle.selectAll();

    await click('Bullet list');
    expect(docContains(onChange, 'bulletList')).toBe(true);

    await click('Bullet list');
    // Lifting out of the list must not have eaten the content on the way through.
    expect(JSON.stringify(currentDoc(onChange))).toContain('hello world');
  });

  it('returns focus to the document after a command', async () => {
    const { handle } = await setup();
    handle.selectAll();
    await click('Bold');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox')));
  });
});

/**
 * The toolbar derives everything from the live editor, including a dozen `can()` probes that run
 * on every transaction. Those fork the state to dry-run a command, and a mistake there would show
 * up as the document changing, or as undo history appearing, purely because the toolbar rendered.
 */
describe('rendering the toolbar does not touch the document', () => {
  it('leaves the document JSON unchanged across selection-driven re-renders', async () => {
    const { onChange, handle } = await setup();

    // Force the selector (and its can() probes) to run repeatedly.
    handle.selectAll();
    await waitFor(() => expect(screen.getByRole('textbox')).toBeInTheDocument());
    const before = JSON.stringify(currentDoc(onChange));

    for (let i = 0; i < 5; i += 1) {
      handle.selectAll();
    }
    await waitFor(() => expect(screen.getByRole('textbox')).toBeInTheDocument());

    expect(JSON.stringify(currentDoc(onChange))).toBe(before);
  });

  it('does not make undo available just by rendering', async () => {
    await setup();
    // A freshly mounted editor has nothing to undo. If a can() probe had committed a
    // transaction, Undo would have become enabled without the user doing anything.
    expect(toggle('Undo')).toBeDisabled();
    expect(toggle('Redo')).toBeDisabled();
  });

  it('keeps Undo disabled while only the selection moves', async () => {
    const { handle } = await setup();
    handle.selectAll();
    await waitFor(() => expect(screen.getByRole('textbox')).toBeInTheDocument());
    expect(toggle('Undo')).toBeDisabled();
  });

  it('enables Undo only after a real edit, and Redo only after an undo', async () => {
    const { handle } = await setup();
    handle.selectAll();

    await click('Bold');
    await waitFor(() => expect(toggle('Undo')).toBeEnabled());
    // Redo is still nothing to redo.
    expect(toggle('Redo')).toBeDisabled();

    await click('Undo');
    await waitFor(() => expect(toggle('Redo')).toBeEnabled());
  });
});
