import { expect, test } from '../fixtures';

test.describe('login', () => {
  test.beforeEach(async ({ loginPage }) => {
    await loginPage.open();
  });

  test('shows the form', async ({ loginPage }) => {
    await expect(loginPage.form()).toBeVisible();
  });

  test('rejects a wrong password', { tag: '@slow' }, async ({ loginPage, page }) => {
    await page.keyboard.type('nope');
    await loginPage.submit();
    await expect(loginPage.error()).toHaveText('Wrong password');
  });
});
