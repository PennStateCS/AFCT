/**
 * The look of a conventional text link.
 *
 * The underline is the point, and it is an accessibility requirement rather than taste.
 * These links used to reveal their underline only on hover, which left colour as the only
 * thing marking them at rest, and the colour does not carry that on its own: `--link` is
 * 2.66:1 against body text in light and 2.43:1 in dark, both under the 3:1 that WCAG's
 * G183 asks for when colour is the sole cue. Against `--muted-foreground` it is 1.13:1 and
 * 1.01:1 — in dark, a link and the helper text beside it are the same luminance. A file
 * name sitting next to "uploaded 2 days ago" is exactly that case (WCAG 1.4.1).
 *
 * The fix is the underline, NOT a louder link colour: the tokens are already comfortably
 * past AA against their backgrounds, and pushing them further to win a fight with muted
 * text would wreck the hierarchy that muted text exists to create.
 *
 * This is for conventional textual hyperlinks and the buttons that look like them. It is
 * NOT for navigation whose role is already obvious from structure: sidebar items, the
 * local rail, tabs, menu items, cards that act as links, pagination, or breadcrumbs (a
 * breadcrumb is recognisable from its separators and position, so it keeps hover-only).
 *
 * Compose with `cn` so per-site sizing and truncation can be added:
 *   cn(TEXT_LINK_CLASS, 'text-xs break-all')
 */
export const TEXT_LINK_CLASS =
  'text-link underline decoration-1 underline-offset-2 hover:text-link-hover';
