import { test, expect, type Browser, type Page } from '@playwright/test';
import { createFixtureCourse, signIn, unique } from './helpers';

/**
 * The description editor's SURFACE and the unsaved-changes guard: everything here is layout,
 * real navigation, or real Escape semantics, which the Vitest suite structurally cannot see
 * (jsdom has no layout and no navigation). This spec is the standing browser verification for
 * the editor click/resize/tooltip work and both halves of the guard.
 *
 * The toolbar's overflow tiers are container queries against the EDITOR's width, not the
 * viewport. On the assignment Details tab the form caps at max-w-2xl (42rem), which sits
 * between the 40rem and 52rem tiers, so the medium tier (structure in the More menu) is the
 * steady state there even on a wide screen; the wide tier is reachable through the expanded
 * editor, and the narrow tier by shrinking the viewport below the container's minimum.
 */

let COURSE = '';
let ASSIGNMENT = '';

test.beforeAll(async ({ browser }) => {
  COURSE = await createFixtureCourse(browser);
  ASSIGNMENT = await createAssignment(browser);
});

async function createAssignment(browser: Browser): Promise<string> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await signIn(page, 'faculty2');
    const res = await page.request.post(`/api/courses/${COURSE}/assignments`, {
      data: {
        title: unique('Editor UX'),
        dueDate: new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
        assignedToEveryone: true,
        isPublished: false,
      },
    });
    expect(res.ok(), `assignment create failed: ${res.status()} ${await res.text()}`).toBe(true);
    return ((await res.json()) as { id: string }).id;
  } finally {
    await context.close();
  }
}

async function openDetails(page: Page) {
  await signIn(page, 'faculty2');
  await page.goto(`/dashboard/courses/${COURSE}/${ASSIGNMENT}?tab=description`);
  // Generous: under `next dev` a first hit on a route compiles it, and that is not the thing
  // being tested.
  await expect(page.getByLabel('Title')).toBeVisible({ timeout: 60_000 });
}

const editorBox = (page: Page) =>
  page.locator('[data-slot="rich-description-editor"].resize-y').first();
const textbox = (page: Page) =>
  page.locator('[data-slot="rich-description-editor"] .tiptap').first();

test.describe('description editor surface', () => {
  test('clicking the blank area of the box places a caret', async ({ page }) => {
    await openDetails(page);
    const box = await editorBox(page).boundingBox();
    expect(box).not.toBeNull();

    // Near the bottom of the box: far below any text line in an empty description.
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height - 15);
    await expect(textbox(page)).toBeFocused();
    await page.keyboard.type('caret landed here');

    await expect(textbox(page)).toContainText('caret landed here');
  });

  test('the editor grows when its grip is dragged', async ({ page }) => {
    await openDetails(page);
    const before = await editorBox(page).boundingBox();
    expect(before).not.toBeNull();

    // The browser-native resize grip lives in the bottom-right corner.
    const gripX = before!.x + before!.width - 6;
    const gripY = before!.y + before!.height - 6;
    await page.mouse.move(gripX, gripY);
    await page.mouse.down();
    await page.mouse.move(gripX, gripY + 140, { steps: 8 });
    await page.mouse.up();

    const after = await editorBox(page).boundingBox();
    expect(after!.height).toBeGreaterThan(before!.height + 80);
  });

  /**
   * The Details form is `max-w-2xl`, so its toolbar container is about 670px. With alignment on
   * the bar the row needs 681px, so this page sits at the narrow tier: alignment goes into the
   * menu with the structure commands. Getting that boundary wrong is what put the trailing
   * controls on a second line, which is the whole reason these widths are asserted.
   */
  test('the Details-tab toolbar fits on one row, with alignment in the More menu', async ({
    page,
  }) => {
    await openDetails(page);

    await expect(page.getByRole('button', { name: 'More formatting' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Bullet list' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Align left' })).toBeHidden();

    // One row: every visible control shares the top offset of the first one.
    const rows = await page
      .locator('[role="group"][aria-label="Formatting"]')
      .first()
      .evaluate(
        (el) =>
          new Set(
            (Array.from(el.children) as HTMLElement[])
              .filter((k) => k.offsetParent !== null && k.offsetWidth > 4)
              .map((k) => k.offsetTop),
          ).size,
      );
    expect(rows).toBe(1);

    await page.getByRole('button', { name: 'More formatting' }).click();
    await expect(page.getByRole('menuitemcheckbox', { name: 'Quote' })).toBeVisible();
    await expect(page.getByRole('menuitemcheckbox', { name: 'Align left' })).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('the expanded editor reaches the wide tier and its gutters take clicks', async ({
    page,
  }) => {
    await openDetails(page);
    await page.getByRole('button', { name: 'Expand editor' }).click();

    // Full-viewport width crosses 52rem: every structure button is a real button again.
    await expect(page.getByRole('button', { name: 'Bullet list' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'More formatting' })).toBeHidden();

    // The document is left-aligned with a capped measure, so the empty gutter is the space to
    // the RIGHT of the column. A click out there still has to land a caret rather than do
    // nothing; that is the whole job of the click net.
    const dialog = page.getByRole('dialog');
    const box = await dialog.boundingBox();
    await page.mouse.click(box!.x + box!.width - 60, box!.y + box!.height / 2);
    await expect(textbox(page)).toBeFocused();
    await page.keyboard.type('gutter click landed');
    await expect(textbox(page)).toContainText('gutter click landed');

    await page.getByRole('button', { name: 'Exit expanded view' }).click();
  });

  test('a narrow viewport reaches the narrow tier: alignment joins the menu', async ({ page }) => {
    await page.setViewportSize({ width: 520, height: 900 });
    await openDetails(page);

    await page.getByRole('button', { name: 'More formatting' }).click();
    await expect(page.getByRole('menuitemcheckbox', { name: 'Align left' })).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('a hovered toolbar button still explains itself', async ({ page }) => {
    await openDetails(page);

    await page.getByRole('button', { name: 'Bold' }).hover();
    await expect(page.getByRole('tooltip', { name: /Bold/ })).toBeVisible({ timeout: 3000 });

    // What this does NOT assert is the 600ms delay before it opens. Checking "still hidden
    // immediately after hover" is a race: driving the pointer is a round trip to the browser,
    // and on a loaded machine that alone can outlast the delay, which is how this failed. Doing
    // it properly means freezing the page clock, which is a lot of machinery for a comfort
    // setting. The delay is a constant in RichDescriptionToolbar and is on the manual checklist.
  });

  test('the keyboard shortcuts dialog lists what the buttons say', async ({ page }) => {
    await openDetails(page);
    await page.getByRole('button', { name: 'Keyboard shortcuts' }).click();

    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Bold');
    await expect(dialog).toContainText('Ctrl/Command+B');

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });
});

test.describe('unsaved-changes guard', () => {
  test('a dirty form challenges a link click; Stay preserves, Discard on a tab switches', async ({
    page,
  }) => {
    await openDetails(page);
    await page.getByLabel('Title').fill('Edited and not saved');

    // An ordinary in-app link: the course link in the assignment header.
    await page
      .getByRole('link', { name: /E2E Fixture Course/ })
      .first()
      .click();
    const confirm = page.getByRole('dialog', { name: 'Discard unsaved changes?' });
    await expect(confirm).toBeVisible();

    await confirm.getByRole('button', { name: 'Stay on page' }).click();
    await expect(confirm).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`${ASSIGNMENT}`));
    await expect(page.getByLabel('Title')).toHaveValue('Edited and not saved');

    // Programmatic navigation: the tab bar. Discard completes it exactly once.
    await page.getByRole('tab', { name: 'Problems' }).click();
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Discard changes' }).click();
    await expect(page).toHaveURL(/tab=problems/);
  });

  test('reverting the edit releases the guard', async ({ page }) => {
    await openDetails(page);
    const title = page.getByLabel('Title');
    const original = await title.inputValue();

    await title.fill('Temporarily different');
    await title.fill(original);
    await page.getByRole('tab', { name: 'Type' }).click();

    await expect(page.getByRole('dialog', { name: 'Discard unsaved changes?' })).toBeHidden();
    await expect(page).toHaveURL(/tab=type/);
  });

  test('a dirty Create Problem dialog challenges Escape; a pristine one closes silently', async ({
    page,
  }) => {
    await openDetails(page);
    await page.goto(`/dashboard/courses/${COURSE}/${ASSIGNMENT}?tab=problems`);

    // Pristine: open and Escape, no questions.
    await page.getByRole('button', { name: 'Create Problem' }).first().click();
    const wizard = page.getByRole('dialog', { name: 'Create Problem' });
    await expect(wizard).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(wizard).toBeHidden();
    await expect(page.getByRole('dialog', { name: 'Discard unsaved changes?' })).toBeHidden();

    // Dirty: type a title, then Escape asks; Keep editing preserves; Discard closes.
    await page.getByRole('button', { name: 'Create Problem' }).first().click();
    await wizard.getByLabel('Title').fill('Half-built problem');
    await page.keyboard.press('Escape');
    const confirm = page.getByRole('dialog', { name: 'Discard unsaved changes?' });
    await expect(confirm).toBeVisible();

    await confirm.getByRole('button', { name: 'Keep editing' }).click();
    await expect(confirm).toBeHidden();
    await expect(wizard.getByLabel('Title')).toHaveValue('Half-built problem');

    // Re-ask. Scope the buttons to the confirm and wait for it: an unscoped lookup can resolve
    // to the PREVIOUS confirm while it is still playing its exit animation, and that node
    // detaches mid-click.
    await page.keyboard.press('Escape');
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Discard changes' }).click();
    await expect(wizard).toBeHidden();
  });

  test('a dirty page arms the browser-level unload guard', async ({ page }) => {
    await openDetails(page);

    // Pristine: no handler, so the browser's back/forward cache is not disabled app-wide.
    const before = await page.evaluate(() => typeof window.onbeforeunload);
    expect(before).toBe('object');

    await page.getByLabel('Title').click();
    await page.keyboard.type(' edited');

    // Dirty: a handler exists. Asserting the LISTENER rather than the native prompt is
    // deliberate: whether headless Chromium renders the dialog depends on user-activation
    // heuristics, and a test that encodes those is testing the browser, not this app. The
    // prompt itself is on the manual checklist.
    const armed = await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(armed).toBe(true);
  });
});
