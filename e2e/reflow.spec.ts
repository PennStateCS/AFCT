import { expect, test, type Page } from '@playwright/test';
import { signIn } from './helpers';

/**
 * Reflow: no horizontal scrolling at 320 CSS px (WCAG 2.1 SC 1.4.10).
 *
 * A phone-width page that scrolls sideways is the failure students actually report, and it
 * is invisible to the Vitest suite because jsdom does no layout. Four representative pages,
 * not forty: this is the smoke suite, and the pattern that breaks (a grid column sized to
 * min-content, a nowrap row, a fixed-width control) breaks the same way everywhere.
 */

const NARROW = { width: 320, height: 800 };

/** How far past the viewport the page can be scrolled, in CSS px. */
async function horizontalOverflow(page: Page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    return Math.max(0, root.scrollWidth - root.clientWidth);
  });
}

/** The widest thing sticking out, so a failure says what to fix rather than just "16px". */
async function widestOffender(page: Page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    let worst = '';
    let by = 0;
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      if (el.closest('svg') || !el.getClientRects().length) continue;
      const r = el.getBoundingClientRect();
      if (r.right - vw > by) {
        by = r.right - vw;
        const cls = typeof el.className === 'string' ? el.className : '';
        worst = `<${el.tagName.toLowerCase()} class="${cls.slice(0, 120)}"> +${Math.round(r.right - vw)}px`;
      }
    }
    return worst;
  });
}

async function expectNoSidewaysScroll(page: Page) {
  // 1px of slack: sub-pixel rounding on a border can report a fraction with nothing wrong.
  expect(await horizontalOverflow(page), await widestOffender(page)).toBeLessThanOrEqual(1);
}

test.use({ viewport: NARROW });

test('login page fits a 320px screen', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign In' }).waitFor();
  await expectNoSidewaysScroll(page);
});

test('student dashboard fits a 320px screen', async ({ page }) => {
  await signIn(page, 'student');
  await page.getByRole('main').waitFor();
  await page.waitForLoadState('networkidle');
  await expectNoSidewaysScroll(page);
});

test('the courses list fits a 320px screen', async ({ page }) => {
  await signIn(page, 'student');
  await page.goto('/dashboard/courses');
  await page.getByRole('main').waitFor();
  await page.waitForLoadState('networkidle');
  await expectNoSidewaysScroll(page);
});

test('a table page fits a 320px screen', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto('/dashboard/users');
  await page.getByRole('main').waitFor();
  await page.waitForLoadState('networkidle');
  await expectNoSidewaysScroll(page);
});

/**
 * Card labels are not squeezed under their own width.
 *
 * Below 640px a table becomes stacked cards of label/value pairs, and the label and the value
 * share one flex row. Letting the label shrink freely made the flex algorithm hand it a share
 * of the shortfall in proportion to its size, so a short label beside a long value ended up
 * narrower than the word it holds and was broken across lines: "Nam / e", "Facult / y". Wrapping
 * between words is fair game, so this counts line boxes against words rather than forbidding a
 * second line outright. Verified by putting `min-w-0` back on the label and watching it fail.
 */
test('a card label is never broken mid-word', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto('/dashboard/courses');
  await page.getByRole('main').waitFor();
  await page.waitForLoadState('networkidle');
  await page.locator('dl dt').first().waitFor();

  const broken = await page.evaluate(() =>
    Array.from(document.querySelectorAll('dl dt'))
      .map((dt) => {
        const range = document.createRange();
        range.selectNodeContents(dt);
        const text = (dt.textContent ?? '').trim();
        return { text, lines: range.getClientRects().length, words: text.split(/\s+/).length };
      })
      .filter((label) => label.lines > label.words)
      .map((label) => `"${label.text}" over ${label.lines} lines`),
  );
  expect(broken, broken.join(', ')).toEqual([]);
});
