import { describe, expect, it } from 'vitest';
import { TEXT_LINK_CLASS } from './link-styles';
import { buttonVariants } from '@/components/ui/button';

/**
 * A WCAG 1.4.1 regression guard, not a style preference.
 *
 * These links used to reveal their underline only on hover, so at rest colour was the only
 * thing marking them. The link token is 2.66:1 against body text in light and 2.43:1 in
 * dark (G183 wants 3:1 when colour is the sole cue), and against muted text it is 1.13:1
 * and 1.01:1 — the same luminance. If someone "tidies" the underline back to hover-only,
 * this fails.
 */
describe('TEXT_LINK_CLASS', () => {
  it('underlines at rest rather than on hover', () => {
    expect(TEXT_LINK_CLASS).toMatch(/(^|\s)underline(\s|$)/);
    expect(TEXT_LINK_CLASS).not.toMatch(/hover:underline/);
  });

  it('keeps a visible hover change', () => {
    expect(TEXT_LINK_CLASS).toContain('hover:text-link-hover');
  });

  it('uses the semantic link token, not the primary fill colour', () => {
    expect(TEXT_LINK_CLASS).toContain('text-link');
    expect(TEXT_LINK_CLASS).not.toContain('text-primary');
  });

  it('keeps the underline restrained', () => {
    expect(TEXT_LINK_CLASS).toContain('decoration-1');
    expect(TEXT_LINK_CLASS).toContain('underline-offset-2');
  });
});

describe('Button variant="link"', () => {
  // It exists to look like a hyperlink, so it carries a hyperlink's non-colour cue.
  const cls = buttonVariants({ variant: 'link' });

  it('underlines at rest, like every other text link', () => {
    expect(cls).toMatch(/(^|\s)underline(\s|$)/);
    expect(cls).not.toMatch(/hover:underline/);
  });

  it('still changes colour on hover', () => {
    expect(cls).toContain('hover:text-link-hover');
  });
});
