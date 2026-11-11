import { test as base } from '@playwright/test';
import { LoginPage } from '../pages/login';

export const test = base.extend<{ loginPage: LoginPage }>({
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },
});

test('logs in', async ({ loginPage }) => {
  await loginPage.open();
  await loginPage.submit();
});
