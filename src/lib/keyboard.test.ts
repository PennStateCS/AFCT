/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { isTextEntryTarget } from './keyboard';

/** A keydown carrying `target`, which is what the helper actually reads. */
const eventFrom = (target: EventTarget | null): KeyboardEvent =>
  ({ target }) as unknown as KeyboardEvent;

const element = (tag: string, contentEditable = false) => {
  const el = document.createElement(tag);
  if (contentEditable) Object.defineProperty(el, 'isContentEditable', { value: true });
  return el;
};

describe('isTextEntryTarget', () => {
  it.each(['input', 'textarea', 'select'])('is true for a %s', (tag) => {
    expect(isTextEntryTarget(eventFrom(element(tag)))).toBe(true);
  });

  it('is true for a contenteditable region, which is what a rich text editor is', () => {
    expect(isTextEntryTarget(eventFrom(element('div', true)))).toBe(true);
  });

  it.each(['div', 'button', 'body'])('is false for a plain %s', (tag) => {
    expect(isTextEntryTarget(eventFrom(element(tag)))).toBe(false);
  });

  it('is false when there is no target at all', () => {
    expect(isTextEntryTarget(eventFrom(null))).toBe(false);
  });

  it('ignores modifiers, which are the caller’s business', () => {
    // The sidebar's shortcut is defined by its modifier. If this helper rejected modified events
    // the guard built on it would disable that shortcut everywhere instead of only while typing.
    const withCtrl = { target: element('div'), ctrlKey: true } as unknown as KeyboardEvent;
    expect(isTextEntryTarget(withCtrl)).toBe(false);
  });
});
