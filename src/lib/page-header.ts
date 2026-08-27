/**
 * The icon beside a page title.
 *
 * Ten pages draw one, and they had drifted into three treatments: a muted grey tile on
 * most, emerald on Courses and violet on User Accounts. Read together that promised a
 * colour code the app does not have, since nothing tells you what emerald means, and it
 * left the tile competing with the badges and status colours further down the same page.
 *
 * No tile at all now, and no colour of its own: a bare glyph in the title's own ink, so
 * the icon and the words read as one heading rather than as a chip with a label after it.
 * That also means it needs nothing per theme. It inherits, so it is correct in dark and in
 * high contrast for free, and it stays correct if a page title is ever given a colour.
 *
 * size-7 against a text-2xl title, the same ratio the dashboard cards use for their bare
 * glyphs (size-5 against text-base). Without a tile behind it an icon matched to the font
 * size reads as a bullet rather than as the heading's mark.
 */
export const PAGE_HEADER_ICON_CLASS = 'size-7 shrink-0';
