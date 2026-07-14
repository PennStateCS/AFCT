// Per-course "empty string notation": how the empty string is rendered in
// automata/languages (and passed to the JFLAP/JFF viewer as its epsSymbol).
//
// Kept free of any @prisma/client runtime import so it is safe to use from
// client components. The string values mirror the Prisma `EmptyStringNotation`
// enum exactly, so they interchange with it in server code.
//
// Add future notations here (value + symbol + option label) and they flow
// through the dropdowns, validation, and the viewer automatically.

export const EMPTY_STRING_NOTATIONS = ['EPSILON', 'LAMBDA'] as const;
export type EmptyStringNotation = (typeof EMPTY_STRING_NOTATIONS)[number];

export const DEFAULT_EMPTY_STRING_NOTATION: EmptyStringNotation = 'EPSILON';

/** The symbol shown for each notation. */
export const EMPTY_STRING_SYMBOL: Record<EmptyStringNotation, string> = {
  EPSILON: 'ε',
  LAMBDA: 'λ',
};

/** Dropdown options in display order. */
export const EMPTY_STRING_NOTATION_OPTIONS: {
  value: EmptyStringNotation;
  label: string;
}[] = [
  { value: 'EPSILON', label: 'ε — epsilon' },
  { value: 'LAMBDA', label: 'λ — lambda' },
];

/** True when the value is a known notation. */
export function isEmptyStringNotation(value: unknown): value is EmptyStringNotation {
  return typeof value === 'string' && (EMPTY_STRING_NOTATIONS as readonly string[]).includes(value);
}

/** Normalize an unknown value to a notation, falling back to the default. */
export function toEmptyStringNotation(value: unknown): EmptyStringNotation {
  return isEmptyStringNotation(value) ? value : DEFAULT_EMPTY_STRING_NOTATION;
}

/** Resolve the display symbol for a course's notation (default-safe). */
export function emptyStringSymbol(value: unknown): string {
  return EMPTY_STRING_SYMBOL[toEmptyStringNotation(value)];
}
