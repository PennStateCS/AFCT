import { expect, test, type Browser, type Page } from '@playwright/test';
import { createFixtureCourse, signIn, unique } from './helpers';

/**
 * The breadcrumb used to truncate on a wide screen with room to spare, because its width
 * was capped at 50/60vw and each label at 8/14/22rem. jsdom cannot catch that: it does no
 * layout, so `Navbar.test.tsx` can only prove the caps are gone and the flex sizing is
 * there. Whether text ACTUALLY fits needs a browser, which is what this is for.
 *
 * The assertion is `scrollWidth <= clientWidth`: an element whose content overflows its box
 * reports a larger scrollWidth, which is exactly what an ellipsis means.
 */

const LONG_ASSIGNMENT = 'Programming Assignment 6: Object-Oriented Design and File Processing';

async function createAssignment(browser: Browser, courseId: string, title: string) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await signIn(page, 'faculty2');
    const res = await page.request.post(`/api/courses/${courseId}/assignments`, {
      data: {
        title,
        dueDate: new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
        assignedToEveryone: true,
        isPublished: false,
      },
    });
    expect(res.ok(), `assignment create failed: ${res.status()}`).toBe(true);
    return ((await res.json()) as { id: string }).id;
  } finally {
    await context.close();
  }
}

const fits = (page: Page, selector: string) =>
  page.locator(selector).evaluate((el) => el.scrollWidth <= el.clientWidth);

test.describe('navbar breadcrumb layout', () => {
  let COURSE = '';
  let ASSIGNMENT = '';

  test.beforeAll(async ({ browser }) => {
    COURSE = await createFixtureCourse(browser);
    ASSIGNMENT = await createAssignment(browser, COURSE, unique(LONG_ASSIGNMENT));
  });

  async function openAssignment(page: Page) {
    await signIn(page, 'faculty2');
    await page.goto(`/dashboard/courses/${COURSE}/${ASSIGNMENT}`);
    await page.getByLabel('Breadcrumb').waitFor({ timeout: 60_000 });
    // The label arrives from the breadcrumb provider once the assignment loads.
    await expect(page.locator('[data-slot="breadcrumb-page"]')).toContainText(LONG_ASSIGNMENT, {
      timeout: 60_000,
    });
  }

  test('shows a long title in full on a wide screen', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 900 });
    await openAssignment(page);

    // The original regression: at 1920 there is room for the whole trail, so nothing
    // should be clipped.
    expect(await fits(page, '[data-slot="breadcrumb-page"]')).toBe(true);
    expect(await fits(page, '[data-slot="breadcrumb-list"]')).toBe(true);
  });

  test('never overflows the header, at any width', async ({ page }) => {
    for (const width of [320, 390, 640, 768, 1024, 1280, 1366, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      if (width === 320) await openAssignment(page);
      await page.waitForTimeout(150);

      const header = page.locator('header').first();
      expect(await header.evaluate((el) => el.scrollWidth <= el.clientWidth), `header at ${width}px`).toBe(true);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        `page at ${width}px`,
      ).toBe(true);
      // The two fixed controls survive every width.
      await expect(page.getByRole('button', { name: 'Toggle theme' })).toBeVisible();
      // The current page is the one crumb a phone keeps.
      await expect(page.locator('[data-slot="breadcrumb-page"]')).toBeVisible();
    }
  });

  test('takes the width the sidebar gives back when it collapses', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openAssignment(page);

    const listWidth = () =>
      page.locator('[data-slot="breadcrumb-list"]').evaluate((el) => el.clientWidth);
    const expanded = await listWidth();

    // Collapsing the rail frees real estate; the trail must actually claim it rather than
    // sitting at a fixed cap.
    await page.getByRole('button', { name: /sidebar/i }).first().click();
    await page.waitForTimeout(400);
    const collapsed = await listWidth();

    expect(collapsed).toBeGreaterThan(expanded);
  });
});
