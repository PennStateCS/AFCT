/**
 * Shared guard for shortcuts bound to the window.
 *
 * A global listener fires no matter where focus is, so every app-level shortcut has to decide
 * what to do while somebody is typing. Answering that in one place keeps the list of text-entry
 * elements from drifting apart between the handlers that ask.
 */

/**
 * True when the key event came from somewhere the user enters text.
 *
 * Deliberately about the target only, and not about modifiers. The two questions are different
 * and conflating them breaks one caller or the other: a bare-letter shortcut also wants to stay
 * dormant whenever any modifier is held, while a shortcut that is *defined* by its modifier
 * (Ctrl+B for the sidebar) would never fire again if it asked that. Callers that want both add
 * the modifier check themselves.
 *
 * `isContentEditable` is the case that matters most. The rich description editor is a
 * contenteditable region that claims Ctrl+B for bold, and bold is the documented binding, so a
 * window-level shortcut sharing the chord has to yield to it.
 */
export function isTextEntryTarget(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  const tag = target?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!target?.isContentEditable;
}
