/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest';
import { shouldEnterAdvanceStep } from './wizard-keyboard';

const make = (html: string): HTMLElement => {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host.firstElementChild as HTMLElement;
};

describe('shouldEnterAdvanceStep', () => {
  it('advances from a single-line text input', () => {
    expect(shouldEnterAdvanceStep(make('<input type="text" />'))).toBe(true);
    expect(shouldEnterAdvanceStep(make('<input type="number" />'))).toBe(true);
    expect(shouldEnterAdvanceStep(make('<input />'))).toBe(true);
  });

  it('does not advance from a select (Enter opens/commits it)', () => {
    expect(shouldEnterAdvanceStep(make('<select><option>a</option></select>'))).toBe(false);
  });

  it('does not advance from a textarea or contenteditable', () => {
    expect(shouldEnterAdvanceStep(make('<textarea></textarea>'))).toBe(false);
    const rich = make('<div contenteditable="true"></div>');
    expect(shouldEnterAdvanceStep(rich)).toBe(false);
  });

  it('does not advance from controls that activate or toggle on Enter', () => {
    for (const type of ['file', 'checkbox', 'radio', 'button', 'submit', 'reset', 'range']) {
      expect(shouldEnterAdvanceStep(make(`<input type="${type}" />`))).toBe(false);
    }
    expect(shouldEnterAdvanceStep(make('<button></button>'))).toBe(false);
  });

  it('leaves Enter to combobox/listbox widgets', () => {
    expect(shouldEnterAdvanceStep(make('<input role="combobox" />'))).toBe(false);
    expect(shouldEnterAdvanceStep(make('<input aria-expanded="true" />'))).toBe(false);

    const wrapper = document.createElement('div');
    wrapper.setAttribute('role', 'combobox');
    const inner = document.createElement('input');
    wrapper.appendChild(inner);
    expect(shouldEnterAdvanceStep(inner)).toBe(false);
  });

  it('is safe with a null or non-element target', () => {
    expect(shouldEnterAdvanceStep(null)).toBe(false);
    expect(shouldEnterAdvanceStep({} as EventTarget)).toBe(false);
  });
});
