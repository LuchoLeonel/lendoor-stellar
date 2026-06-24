import { test, expect } from '@playwright/test';

test.describe('Navigation', () => {
  test('navigates from home to stats and back', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('nav-stats').click();
    await expect(page).toHaveURL('/stats');
    await page.getByTestId('header-brand').click();
    await expect(page).toHaveURL('/');
  });
});
