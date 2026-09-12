import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

/**
 * Scrolling a long select on a touch screen.
 *
 * Reported on issue 816 against the account page's timezone list: on a phone the list jumped
 * back to the top as soon as you tried to scroll it. Radix mounts a scroll button the moment
 * the viewport can scroll that way, and on mount the button scrolls the *focused* item back
 * into view. With a mouse that is the item under the pointer, because Radix focuses items on
 * hover, so nothing moves. A finger cannot hover, so focus is still on whatever was selected
 * when the list opened, and the first drag snaps straight back to it.
 *
 * jsdom has no layout, so the scroll buttons never appear there at all and no unit test can
 * hold this. Removing the `canHover` guard in `components/ui/select.tsx` puts the snap back,
 * which is how the fix was confirmed.
 */
test.describe('a long select on a touch screen', () => {
  // Emulation options rather than a device descriptor: a descriptor also carries
  // `defaultBrowserType`, which Playwright refuses inside a describe block. Touch emulation
  // alone is what makes Chromium report `hover: none` and `pointer: coarse`, which is what
  // the component reads.
  test.use({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });

  test('stays where it is scrolled to', async ({ page }) => {
    // The guard is about the pointer, not the screen, so check the emulated context really
    // reports a touch pointer. Without this the test could pass as a desktop one.
    await page.goto('/login');
    expect(await page.evaluate(() => matchMedia('(hover: hover) and (pointer: fine)').matches)).toBe(
      false,
    );

    await signIn(page, 'student');
    await page.goto('/dashboard/account');

    await page.getByRole('combobox', { name: 'Timezone' }).click();
    const listbox = page.getByRole('listbox');
    await expect(listbox).toBeVisible();

    // Radix scrolls the options inside the viewport, not the popover box.
    const viewport = listbox.locator('[data-radix-select-viewport]');
    // A list short enough to fit would pass the assertion below for the wrong reason.
    expect(await viewport.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);

    await viewport.evaluate((el) => {
      el.scrollTop = 200;
    });

    // The snap happens on the scroll event, so give it a frame before looking. Polling would
    // pass on the frame before the snap.
    await page.waitForTimeout(300);
    expect(await viewport.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
  });
});
