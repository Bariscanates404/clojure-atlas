import { test as base } from '@playwright/test';
import { LoginPage } from '../pages/login';

// no type argument: nothing says which class loginPage is, so no link can be proven
const test = base.extend({
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },
});

test('logs in untyped', async ({ loginPage }) => {
  await loginPage.open();
});
