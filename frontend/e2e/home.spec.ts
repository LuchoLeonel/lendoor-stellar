import { test, expect } from '@playwright/test';

// Desde que la landing (LandingV4) tomó la raíz, el Home clásico vive en
// /home y el Header global NO se monta en `/` (la landing trae su propia
// barra). Ver App.tsx.
test.describe('Landing page', () => {
  test('renders landing at root without crashing', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Home page', () => {
  test('renders hero section with CTAs', async ({ page }) => {
    await page.goto('/home');
    await expect(page.getByTestId('hero-cta-borrow')).toBeVisible();
    await expect(page.getByTestId('hero-cta-stats')).toBeVisible();
  });

  test('displays Lendoor brand in header', async ({ page }) => {
    await page.goto('/home');
    await expect(page.getByTestId('header-brand')).toBeVisible();
  });
});
