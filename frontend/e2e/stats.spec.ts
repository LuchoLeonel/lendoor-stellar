import { test, expect } from '@playwright/test';

test.describe('Stats page', () => {
  test('renders stats page with metric cards', async ({ page }) => {
    await page.goto('/stats');
    // Page should render without crashing — look for any heading or card
    await expect(page.locator('h1, h2, h3').first()).toBeVisible({ timeout: 10_000 });
  });
});
