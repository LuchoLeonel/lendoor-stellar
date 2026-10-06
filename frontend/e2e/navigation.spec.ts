import { test, expect } from '@playwright/test';

test.describe('Navigation', () => {
  test('navigates from home to stats and back to the landing', async ({ page, isMobile }) => {
    // La nav del Header es desktop-only (hidden md:flex) — en mobile esos
    // links no existen, así que este flujo solo aplica en viewport >= md.
    test.skip(isMobile, 'Header nav oculta en mobile (hidden md:flex)');
    // El Header global no existe en `/` (landing propia) — arrancamos en /home.
    await page.goto('/home');
    await page.getByTestId('nav-stats').click();
    await expect(page).toHaveURL('/stats');
    // El brand del Header linkea a `/`, que hoy es la landing.
    await page.getByTestId('header-brand').click();
    await expect(page).toHaveURL('/');
  });
});
