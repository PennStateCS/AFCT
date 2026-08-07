import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';
import type { Result } from 'axe-core';
import { createFixtureCourse, signIn, unique } from './helpers';

/**
 * Automated accessibility smoke scan (axe-core) over a few representative pages.
 *
 * Scope note: this suite deliberately excludes the two colour-contrast rules. A separate
 * visual redesign owns colour and contrast, so those findings are tracked there; leaving
 * them on here would drown the structural issues this scan exists to catch (missing
 * names, bad roles, broken landmark/heading structure, unlabeled controls). Every other
 * WCAG 2.0/2.1 A and AA rule stays enabled. Do not widen this exclusion to silence a
 * real finding; fix the markup instead.
 *
 * axe catches only the ~30-40% of WCAG that is machine-checkable. Keyboard operation,
 * focus order, screen-reader wording, and reflow still need a human; see
 * docs/accessibility-audit.md for the manual checklist.
 */

const DISABLED_RULES = ['color-contrast', 'color-contrast-enhanced'];

async function scan(page: Page) {
  return new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .disableRules(DISABLED_RULES)
    .analyze();
}

/** A readable failure message: rule, impact, help URL, and the offending selectors. */
function summarize(violations: Result[]): string {
  return violations
    .map((v) => {
      const nodes = v.nodes.map((n) => `      - ${n.target.join(' ')}`).join('\n');
      return `  [${v.impact ?? 'n/a'}] ${v.id}: ${v.help}\n    ${v.helpUrl}\n${nodes}`;
    })
    .join('\n\n');
}

test.describe('accessibility (axe, contrast excluded)', () => {
  test('login page (signed out)', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Sign In' }).waitFor();
    const { violations } = await scan(page);
    expect(violations, summarize(violations)).toEqual([]);
  });

  test('admin dashboard', async ({ page }) => {
    await signIn(page, 'admin');
    await expect(page).toHaveURL(/\/dashboard/);
    // Let the dashboard shell settle (sidebar + main content) before scanning.
    await page.getByRole('main').waitFor();
    const { violations } = await scan(page);
    expect(violations, summarize(violations)).toEqual([]);
  });

  test('admin system settings', async ({ page }) => {
    await signIn(page, 'admin');
    await page.goto('/dashboard/system-settings');
    await page.getByRole('main').waitFor();
    const { violations } = await scan(page);
    expect(violations, summarize(violations)).toEqual([]);
  });

  test('student dashboard', async ({ page }) => {
    await signIn(page, 'student');
    await expect(page).toHaveURL(/\/dashboard/);
    await page.getByRole('main').waitFor();
    const { violations } = await scan(page);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

/**
 * The description editor and the dialogs layered over it.
 *
 * These are scanned separately because none of them exist in the page's resting state: the
 * toolbar's menus, the equation/link/shortcut dialogs and the discard confirm are all opened by
 * the user, and a scan of the page behind them proves nothing about them. Radix portals each one
 * to the document body, so scanning the whole page with it open is the right scope.
 */
test.describe('accessibility: description editor (axe, contrast excluded)', () => {
  let COURSE = '';
  let ASSIGNMENT = '';

  test.beforeAll(async ({ browser }) => {
    COURSE = await createFixtureCourse(browser);
    ASSIGNMENT = await createAssignment(browser, COURSE);
  });

  async function createAssignment(browser: Browser, courseId: string): Promise<string> {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await signIn(page, 'faculty2');
      const res = await page.request.post(`/api/courses/${courseId}/assignments`, {
        data: {
          title: unique('A11y editor'),
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
    // Generous: under `next dev` a first hit on a route compiles it.
    await expect(page.getByLabel('Title')).toBeVisible({ timeout: 60_000 });
  }

  test('the editor at rest', async ({ page }) => {
    await openDetails(page);
    await page.getByRole('textbox', { name: 'Description' }).waitFor();
    const { violations } = await scan(page);
    expect(violations, summarize(violations)).toEqual([]);
  });

  test('the expanded editor', async ({ page }) => {
    await openDetails(page);
    await page.getByRole('button', { name: 'Expand editor' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    const { violations } = await scan(page);
    expect(violations, summarize(violations)).toEqual([]);
  });

  test('the equation dialog', async ({ page }) => {
    await openDetails(page);
    await page.getByRole('button', { name: 'Insert equation' }).click();
    await expect(page.getByLabel('LaTeX')).toBeVisible();
    const { violations } = await scan(page);
    expect(violations, summarize(violations)).toEqual([]);
  });

  test('the link dialog', async ({ page }) => {
    await openDetails(page);
    await page.getByRole('button', { name: 'Add link' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    const { violations } = await scan(page);
    expect(violations, summarize(violations)).toEqual([]);
  });

  test('the keyboard shortcuts dialog', async ({ page }) => {
    await openDetails(page);
    await page.getByRole('button', { name: 'Keyboard shortcuts' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    const { violations } = await scan(page);
    expect(violations, summarize(violations)).toEqual([]);
  });

  /**
   * The overflow menu, minus one known app-wide finding.
   *
   * Every Radix dropdown menu in AFCT trips `aria-hidden-focus`: opening one marks the page
   * behind it `aria-hidden` while its ~60 links and buttons stay focusable. It is not specific
   * to this menu (a menu on /dashboard/users reports the same thing) and not something the
   * editor work introduced. An open Dialog leaves the DOM in the identical state; axe stays
   * quiet there only because it special-cases the modal-dialog pattern, and a menu is not one.
   *
   * In practice focus cannot land there: the background is `pointer-events: none` and Radix's
   * focus scope pulls focus back, verified in a browser. The real fix is `inert` on the
   * background instead of `aria-hidden`, which is upstream Radix behaviour, so it is tracked
   * rather than patched here. Everything else in the menu is still scanned, so a NEW violation
   * fails this test.
   */
  const KNOWN_MENU_FINDING = 'aria-hidden-focus';

  test('the toolbar overflow menu', async ({ page }) => {
    await openDetails(page);
    await page.getByRole('button', { name: 'More formatting' }).first().click();
    await expect(page.getByRole('menu')).toBeVisible();
    const { violations } = await scan(page);
    const unexpected = violations.filter((v) => v.id !== KNOWN_MENU_FINDING);
    expect(unexpected, summarize(unexpected)).toEqual([]);
  });

  test('the discard-changes confirm', async ({ page }) => {
    await openDetails(page);
    await page.getByLabel('Title').fill('Renamed while auditing');
    // Any in-app link triggers the guard's capture-phase interception.
    await page.getByRole('link', { name: 'Dashboard' }).first().click();
    await expect(page.getByRole('dialog', { name: 'Discard unsaved changes?' })).toBeVisible();
    const { violations } = await scan(page);
    expect(violations, summarize(violations)).toEqual([]);
  });

  /**
   * Focus management, which axe cannot see: it inspects a snapshot, and these are all about
   * where focus GOES when something opens or closes. Losing focus to the document body strands
   * a keyboard user at the top of the page with no idea what happened, which is why every one
   * of these has explicit code behind it. Until now none of it was asserted anywhere.
   */
  test('leaving the expanded editor returns focus to the Expand button', async ({ page }) => {
    await openDetails(page);
    const expand = page.getByRole('button', { name: 'Expand editor' });
    await expand.click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(expand).toBeFocused();
  });

  test('the discard confirm opens on the safe choice, so Enter stays', async ({ page }) => {
    await openDetails(page);
    await page.getByLabel('Title').fill('Renamed while auditing');
    await page.getByRole('link', { name: 'Dashboard' }).first().click();

    const confirm = page.getByRole('dialog', { name: 'Discard unsaved changes?' });
    await expect(confirm).toBeVisible();
    await expect(confirm.getByRole('button', { name: 'Stay on page' })).toBeFocused();

    // Enter therefore keeps the work rather than throwing it away.
    await page.keyboard.press('Enter');
    await expect(confirm).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`${ASSIGNMENT}`));
    await expect(page.getByLabel('Title')).toHaveValue('Renamed while auditing');
  });

  test('Escape on the confirm keeps the page, and never discards', async ({ page }) => {
    await openDetails(page);
    await page.getByLabel('Title').fill('Renamed while auditing');
    await page.getByRole('link', { name: 'Dashboard' }).first().click();

    const confirm = page.getByRole('dialog', { name: 'Discard unsaved changes?' });
    await expect(confirm).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(confirm).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`${ASSIGNMENT}`));
    await expect(page.getByLabel('Title')).toHaveValue('Renamed while auditing');
  });

  test('Keep editing puts focus back inside the dialog it was protecting', async ({ page }) => {
    await signIn(page, 'faculty2');
    await page.goto(`/dashboard/courses/${COURSE}/${ASSIGNMENT}?tab=problems`);
    await page.getByRole('button', { name: 'Create Problem' }).first().click();

    const wizard = page.getByRole('dialog', { name: 'Create Problem' });
    await expect(wizard).toBeVisible({ timeout: 60_000 });
    await wizard.getByLabel('Title').fill('Half-built problem');
    await page.keyboard.press('Escape');

    const confirm = page.getByRole('dialog', { name: 'Discard unsaved changes?' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Keep editing' }).click();
    await expect(confirm).toBeHidden();

    // The point of Keep editing is to carry on editing. Focus landing on the body instead
    // would drop a keyboard user back at the top of the page with the dialog still open.
    const focusedInWizard = await page.evaluate(() => {
      const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
      const active = document.activeElement;
      return {
        onBody: active === document.body || active === null,
        insideADialog: dialogs.some((d) => d.contains(active)),
        tag: active?.tagName ?? null,
      };
    });
    expect(focusedInWizard.onBody, 'focus was dropped on the body').toBe(false);
    expect(focusedInWizard.insideADialog, 'focus left the Create Problem dialog').toBe(true);
  });

  test('the editor is reachable and escapable by keyboard alone', async ({ page }) => {
    await openDetails(page);
    const box = page.getByRole('textbox', { name: 'Description' });
    await box.focus();
    await expect(box).toBeFocused();

    // Tab must move OUT of the document rather than inserting a tab character: a keyboard user
    // who cannot leave the editor is trapped on the page (WCAG 2.1.2).
    await page.keyboard.press('Tab');
    await expect(box).not.toBeFocused();
  });
});

/**
 * The four server-side paginated tables.
 *
 * These are scanned as a group because they share one component (`DataTable`) but each wires
 * it differently: its own toolbar filters, its own column set, and its own empty state. The
 * shared parts (aria-sort, the single live region in the footer, the labelled search box) are
 * unit-tested in `data-table.test.tsx`; what only a browser can prove is that each caller's
 * filter controls and column headers still come out with accessible names once they are
 * composed together and rendered for real.
 *
 * Scanned at rest with whatever the fixture course holds. An empty table is not a wasted scan:
 * the empty state is its own markup, and it is the state a new course actually starts in.
 *
 * Run the file whole. Isolating this block with `-g` against a freshly started `next dev`
 * makes the fixture's first sign-in the first request to hit the credentials route, and the
 * cold compile lands as "Email or password is incorrect" rather than a timeout, which reads
 * like a seeded-password problem and is not one. The describes above warm that route.
 */
test.describe('accessibility: paginated tables (axe, contrast excluded)', () => {
  let COURSE = '';

  test.beforeAll(async ({ browser }) => {
    COURSE = await createFixtureCourse(browser);
  });

  /** Open a course tab as course staff and wait for its table to exist. */
  async function openCourseTab(page: Page, tab: string, tableName: string) {
    await signIn(page, 'faculty2');
    await page.goto(`/dashboard/courses/${COURSE}?tab=${tab}`);
    // Generous: under `next dev` a first hit on a route compiles it.
    await expect(page.getByRole('table', { name: tableName })).toBeVisible({ timeout: 60_000 });
  }

  test('the course roster', async ({ page }) => {
    await openCourseTab(page, 'roster', 'Course roster table');
    const { violations } = await scan(page);
    expect(violations, summarize(violations)).toEqual([]);
  });

  test('the gradebook', async ({ page }) => {
    await openCourseTab(page, 'grades', 'Course grades table');
    const { violations } = await scan(page);
    expect(violations, summarize(violations)).toEqual([]);
  });

  test('the course activity log', async ({ page }) => {
    await openCourseTab(page, 'activity', 'Activity log table');
    const { violations } = await scan(page);
    expect(violations, summarize(violations)).toEqual([]);
  });

  test('the autograder queue', async ({ page }) => {
    await signIn(page, 'admin');
    await page.goto('/dashboard/autograder');
    await expect(page.getByRole('table', { name: 'Autograder' })).toBeVisible({ timeout: 60_000 });
    const { violations } = await scan(page);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
