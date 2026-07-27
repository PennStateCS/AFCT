import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import type { Result } from 'axe-core';
import { signIn } from './helpers';

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
