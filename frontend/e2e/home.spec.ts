import { test, expect } from '@playwright/test';

test.describe('Home page', () => {
  test('renders hero section with CTAs', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('hero-cta-borrow')).toBeVisible();
    await expect(page.getByTestId('hero-cta-stats')).toBeVisible();
  });

  test('displays Lendoor brand in header', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('header-brand')).toBeVisible();
  });
});
