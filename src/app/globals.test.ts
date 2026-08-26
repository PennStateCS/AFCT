import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guards on the colour tokens that a screenshot would catch and nothing else would.
 *
 * A colour that happens to equal the surface it is painted on does not look wrong, it looks
 * absent, so nobody reports it as a wrong colour: they report the feature as missing, or never
 * notice at all. That is what happened to the viewer's grid in dark mode, where `--grid-color`
 * and `--card` were both lightness 0.21 and the grid simply did not appear.
 */
const css = readFileSync(join(__dirname, 'globals.css'), 'utf8');

/**
 * The declarations inside one top-level block, by selector.
 *
 * A selector may share its block with others, which is how the light palette is written once
 * and applied to both `:root` and the fixed-light auth surface. So this matches the selector at
 * the head of a list rather than immediately before the brace, which is what it used to do and
 * why adding that second selector broke it.
 */
function block(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const start = css.search(new RegExp(`(^|\\n)${escaped}\\s*(,[^{]*)?\\{`));
  expect(start, `${selector} block not found in globals.css`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf('\n}', start));
}

/** The lightness of an `oklch(L C H)` token, which is the first number. */
function lightness(scope: string, token: string): number {
  const match = new RegExp(`--${token}:\\s*oklch\\(([0-9.]+)`).exec(block(scope));
  expect(match, `--${token} not found as an oklch value in ${scope}`).not.toBeNull();
  return Number(match![1]);
}

describe('the JFLAP viewer grid', () => {
  /**
   * The grid is drawn as a background image on a `bg-card` container, so it can only be seen
   * where it differs from `--card`. It needs to be *lighter* in dark mode and darker in light
   * mode, which is why this checks a signed difference rather than just that they differ.
   */
  it('is lighter than the surface it is drawn on, in dark mode', () => {
    const card = lightness('.dark', 'card');
    const grid = lightness('.dark', 'grid-color');

    expect(grid).toBeGreaterThan(card);
    // Enough of a step to be visible rather than merely unequal.
    expect(grid - card).toBeGreaterThanOrEqual(0.03);
  });

  it('is darker than the surface it is drawn on, in light mode', () => {
    const card = lightness(':root', 'card');
    const grid = lightness(':root', 'grid-color');

    expect(grid).toBeLessThan(card);
    expect(card - grid).toBeGreaterThanOrEqual(0.03);
  });
});
