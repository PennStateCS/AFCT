import { expect, test, type Page } from '@playwright/test';
import { signIn } from './helpers';

/**
 * Tables, actually operated.
 *
 * The rest of this suite scans tables for accessibility violations and asserts they exist;
 * nothing clicked a sort header, turned a page, or applied a filter. That left the busiest
 * component in the app covered only by jsdom, which does no layout and, more to the point,
 * cannot exercise the round trip where a client control asks the server for a different page
 * and the server's answer comes back through React Query into the same table.
 *
 * The two halves are deliberately different tables. User Accounts pages, sorts and filters on
 * the SERVER: the table reports the change and renders whatever arrives. Courses does all
 * three in the BROWSER against rows it already holds. They break in different ways, and a
 * change to the table component tends to break exactly one of them.
 */

/** The footer's "Showing 1-10 of 30" line, which is the readable proof of what is on screen. */
function rangeLabel(page: Page) {
  // The footer label and the live region that announces it carry the same text, so this
  // deliberately matches the first and not "the only one".
  return page.getByText(/Showing [\d-]+ of \d+/).first();
}

/**
 * The identifying cell of the top row, which is what "the order changed" is read from.
 *
 * Column 1 rather than 0 on purpose: User Accounts leads with an avatar, so its first text
 * cell is the second one, and the Courses list's second column is its code. Both are stable
 * per row, which is all this needs.
 */
async function firstBodyCell(page: Page) {
  return page.locator('tbody tr').first().locator('td').nth(1).innerText();
}

/** Every value in one column, top to bottom, for asserting an order rather than a swap. */
async function column(page: Page, nth: number) {
  return page.locator(`tbody tr td:nth-child(${nth})`).allInnerTexts();
}

test.describe('a server-paged table', () => {
  test.beforeEach(async ({ page }) => {
    // User Accounts is admin-only, and the seed leaves comfortably more accounts than one
    // page holds, so paging has somewhere to go without this spec creating anything.
    await signIn(page, 'admin');
    await page.goto('/dashboard/users');
    await expect(page.getByRole('heading', { name: /user accounts/i })).toBeVisible({
      timeout: 60_000,
    });
    await expect(rangeLabel(page)).toBeVisible({ timeout: 30_000 });
  });

  test('turns the page and comes back to the same rows', async ({ page }) => {
    const firstOnPageOne = await firstBodyCell(page);
    await expect(rangeLabel(page)).toContainText('Showing 1-');

    await page.getByRole('button', { name: 'Next page' }).click();

    // The label has to move with the rows. A table that renders page two under a label still
    // claiming page one is the failure this is really watching for, because it reads as a
    // browsing bug and is actually a paging bug.
    await expect(rangeLabel(page)).not.toContainText('Showing 1-');
    // Polled, not read once: the label updates from local state while the rows are still
    // in flight, so a plain read here catches page one's rows under page two's label.
    await expect.poll(() => firstBodyCell(page), { timeout: 15_000 }).not.toBe(firstOnPageOne);

    await page.getByRole('button', { name: 'Previous page' }).click();

    await expect(rangeLabel(page)).toContainText('Showing 1-');
    await expect.poll(() => firstBodyCell(page), { timeout: 15_000 }).toBe(firstOnPageOne);
  });

  test('asks the server for a bigger page and says so', async ({ page }) => {
    await expect(rangeLabel(page)).toContainText('Showing 1-10');

    await page.getByRole('combobox', { name: /rows per page/i }).click();
    await page.getByRole('option', { name: '20 / page', exact: true }).click();

    await expect(rangeLabel(page)).toContainText('Showing 1-20');
    await expect(page.locator('tbody tr')).toHaveCount(20);
  });

  test('reports a sort to the server and reorders the rows', async ({ page }) => {
    const firstUnsorted = await firstBodyCell(page);

    await page.getByRole('button', { name: 'Last Name', exact: true }).click();

    // aria-sort on the header cell is what a screen reader reads, and it is also the only
    // thing that says which way the column is going, since the arrow is decorative.
    await expect(page.getByRole('columnheader', { name: /^Last Name/ })).toHaveAttribute(
      'aria-sort',
      /ascending|descending/,
    );
    await expect.poll(async () => firstBodyCell(page), { timeout: 15_000 }).not.toBe(firstUnsorted);
  });
});

test.describe('a client-side table', () => {
  test.beforeEach(async ({ page }) => {
    // The Courses list holds its rows and does the work in the browser, which is the other
    // half of what the table component has to get right.
    await signIn(page, 'admin');
    await page.goto('/dashboard/courses');
    await expect(rangeLabel(page)).toBeVisible({ timeout: 60_000 });
  });

  test('sorts in the browser without going back for rows', async ({ page }) => {
    const totalBefore = await rangeLabel(page).innerText();

    // Asserting the whole column is ordered, not that the top row moved. The seeded list
    // already happens to lead with the lowest code, so "the first cell changed" would pass
    // an unsorted table and fail a correctly sorted one.
    await page.getByRole('button', { name: 'Course Code', exact: true }).click();
    await expect
      .poll(() => column(page, 2), { timeout: 15_000 })
      .toEqual([...(await column(page, 2))].sort());

    await page.getByRole('button', { name: 'Course Code', exact: true }).click();
    const descending = await column(page, 2);
    expect(descending).toEqual([...descending].sort().reverse());

    // Sorting is not filtering: the same rows in a different order, so the count is untouched.
    expect(await rangeLabel(page).innerText()).toBe(totalBefore);
  });

  test('narrows the rows with a value filter and says what it hid', async ({ page }) => {
    const rowsBefore = await page.locator('tbody tr').count();

    await page.getByRole('button', { name: 'Filters' }).click();
    // Whatever the first offered value happens to be. Naming a semester here would tie the
    // spec to the seed, and the behaviour under test is the filtering, not the vocabulary.
    const firstOption = page.getByRole('checkbox').first();
    await firstOption.click();
    await page.keyboard.press('Escape');

    await expect
      .poll(async () => page.locator('tbody tr').count(), { timeout: 15_000 })
      .toBeLessThanOrEqual(rowsBefore);
    // A filtered table says what it is hiding rather than quietly showing fewer rows.
    await expect(rangeLabel(page)).toContainText('filtered from');
  });
});
