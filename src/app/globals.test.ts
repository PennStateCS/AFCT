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

/** The chroma of an `oklch(L C H)` token, which is the second number: how saturated it is. */
function chroma(scope: string, token: string): number {
  const match = new RegExp(`--${token}:\\s*oklch\\([0-9.]+\\s+([0-9.]+)`).exec(block(scope));
  expect(match, `--${token} not found as an oklch value in ${scope}`).not.toBeNull();
  return Number(match![1]);
}

/** The hue of an `oklch(L C H)` token, which is the third number. */
function hue(scope: string, token: string): number {
  const match = new RegExp(`--${token}:\\s*oklch\\([0-9.]+\\s+[0-9.]+\\s+([0-9.]+)`).exec(
    block(scope),
  );
  expect(match, `--${token} not found as an oklch value in ${scope}`).not.toBeNull();
  return Number(match![1]);
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

/**
 * The application shell: one dark neutral pair (the rail and the header band) capping a light
 * neutral workspace, with saturated blue kept for the branded surfaces and primary actions.
 *
 * These are relationships rather than pinned values, because the exact greys are a design
 * decision that is allowed to move. What is not allowed to move is the ordering: a band that
 * drifts back to a light grey, or a rail that stops being the deepest thing on screen, breaks
 * the idea rather than adjusting it. The chroma checks are the other half of that idea: they
 * are what stops the shell being quietly re-tinted blue until the banners no longer stand out.
 */
describe('the application shell', () => {
  it('keeps the rail and the band dark in light mode, with the rail deepest', () => {
    const rail = lightness(':root', 'sidebar');
    const band = lightness(':root', 'navbar');

    expect(rail).toBeLessThan(0.35);
    expect(band).toBeLessThan(0.4);
    // One shell, two layers: the band sits above the rail, and visibly so.
    expect(band).toBeGreaterThan(rail);
    expect(band - rail).toBeGreaterThanOrEqual(0.03);
  });

  it('carries light text on both of them, in light mode', () => {
    expect(lightness(':root', 'navbar-foreground')).toBeGreaterThan(0.9);
    expect(lightness(':root', 'sidebar-foreground')).toBeGreaterThan(0.9);
    // The band's own lighter end still has to be dark enough to hold that text.
    expect(lightness(':root', 'navbar-end')).toBeLessThan(0.45);
  });

  it('keeps the shell neutral and the banner saturated', () => {
    for (const token of ['sidebar', 'navbar', 'navbar-end', 'background', 'card']) {
      expect(chroma(':root', token), `--${token} should be a neutral`).toBeLessThan(0.04);
    }
    // The one place blue is allowed to be the surface.
    expect(chroma(':root', 'course-banner')).toBeGreaterThan(0.06);
    expect(chroma(':root', 'course-banner-accent')).toBeGreaterThan(0.1);
  });

  it('leaves the workspace lighter than the shell and darker than a card', () => {
    const canvas = lightness(':root', 'background');

    expect(canvas).toBeGreaterThan(lightness(':root', 'navbar'));
    expect(canvas).toBeLessThan(lightness(':root', 'card'));
    // A card has to read as a card on it before its border is involved.
    expect(lightness(':root', 'card') - canvas).toBeGreaterThanOrEqual(0.03);
  });

  it('keeps the band dark in dark mode too, and light in high contrast', () => {
    expect(lightness('.dark', 'navbar')).toBeLessThan(0.4);
    expect(lightness('.dark', 'navbar-foreground')).toBeGreaterThan(0.9);

    // High contrast derives from light but inverts this one: a pale band with black on it.
    expect(lightness('.high-contrast', 'navbar')).toBeGreaterThan(0.9);
    expect(lightness('.high-contrast', 'navbar-foreground')).toBeLessThan(0.1);
    // And no gradient at all, which is this theme's rule for decoration.
    expect(lightness('.high-contrast', 'navbar-end')).toBe(lightness('.high-contrast', 'navbar'));
  });
});

/**
 * The work surfaces on top of that shell: a white card or table on the canvas, a header one
 * shade off the body, a hover one shade further, and structural edges kept quieter than the
 * boundary of anything you can operate.
 *
 * All relationships again. The exact greys can move; what these catch is a layer arriving in
 * the wrong order, which is the failure that looks like nothing rather than like a bug: a
 * header that stops being a header, a hover that reads as a selection, a decorative border
 * that has quietly grown stronger than an input's.
 */
describe('the work surfaces', () => {
  it('puts a table on the same surface as a card', () => {
    expect(lightness(':root', 'table-background')).toBe(lightness(':root', 'card'));
    expect(lightness('.dark', 'table-background')).toBe(lightness('.dark', 'card'));
  });

  it('keeps the header off the body, and closer to it than to the canvas', () => {
    const body = lightness(':root', 'table-background');
    const header = lightness(':root', 'table-header');
    const canvas = lightness(':root', 'background');

    expect(header).toBeLessThan(body);
    // A header, not a grey strip: nearer the sheet it caps than the page behind it.
    expect(body - header).toBeLessThan(canvas === header ? 1 : body - canvas);
  });

  it('keeps the row hover between the body and the header it sits under', () => {
    const body = lightness(':root', 'table-background');
    const hover = lightness(':root', 'table-highlight');

    expect(hover).toBeLessThan(body);
    // Visible enough to track a row, quiet enough not to read as a selection.
    expect(body - hover).toBeGreaterThan(0.01);
    expect(body - hover).toBeLessThan(0.12);
  });

  it('keeps a structural edge quieter than the edge of a control', () => {
    // 1.4.11 applies to the input; a card's border is decoration and may be softer.
    expect(lightness(':root', 'border')).toBeGreaterThan(lightness(':root', 'input'));
    expect(lightness('.dark', 'border')).toBeLessThan(lightness('.dark', 'input'));
  });

  it('keeps every neutral surface in one family, in light mode', () => {
    // The zinc/no-hue values these used to be read as warm next to a slate canvas. The check
    // is that they agree with each other, not that they hit a particular number.
    const canvasHue = hue(':root', 'background');
    for (const token of ['muted', 'accent', 'table-header', 'table-highlight', 'secondary']) {
      expect(Math.abs(hue(':root', token) - canvasHue), `--${token} hue`).toBeLessThan(15);
      expect(chroma(':root', token), `--${token} chroma`).toBeLessThan(0.04);
    }
  });
});
