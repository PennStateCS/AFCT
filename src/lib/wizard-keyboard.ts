/**
 * Whether an Enter keypress on `target` should advance a wizard step.
 *
 * The wizard dialogs listen for Enter at the form level so that typing a value and
 * pressing Enter moves to the next step instead of submitting a half-built form. That
 * shortcut must be narrow: only a single-line text input qualifies. Every other control
 * has its own native Enter behavior that a form-level handler would otherwise swallow:
 *
 *  - `<select>`: Enter opens/commits the dropdown.
 *  - `<textarea>` / contenteditable: Enter inserts a newline.
 *  - buttons, file, checkbox, radio, range, submit/reset: Enter activates or toggles them.
 *  - combobox/listbox widgets: they render a text input but handle Enter themselves to
 *    pick the highlighted option.
 */
export function shouldEnterAdvanceStep(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;

  // Rich text surfaces own Enter.
  if (el.isContentEditable) return false;

  // Only plain inputs; <select>, <button>, <textarea> and anything else keep their own.
  if (el.tagName !== 'INPUT') return false;

  const type = (el as HTMLInputElement).type?.toLowerCase() ?? 'text';
  const ownsEnter = new Set([
    'button',
    'checkbox',
    'color',
    'file',
    'image',
    'radio',
    'range',
    'reset',
    'submit',
  ]);
  if (ownsEnter.has(type)) return false;

  // A text input acting as (or inside) a combobox/listbox resolves Enter itself.
  if (el.getAttribute('role') === 'combobox') return false;
  if (el.getAttribute('aria-expanded') === 'true') return false;
  if (typeof el.closest === 'function' && el.closest('[role="combobox"], [role="listbox"]')) {
    return false;
  }

  return true;
}
