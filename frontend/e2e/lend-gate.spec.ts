import { test, expect } from '@playwright/test';

test.describe('Lend page gate', () => {
  test('shows connect wallet prompt when not authenticated', async ({ page }) => {
    await page.goto('/lend');
    await expect(page.getByTestId('connect-wallet-prompt').or(page.getByText(/connect/i).first())).toBeVisible({ timeout: 10_000 });
  });
});
