import { test as base } from '@playwright/test';
import { CartPage } from '../pages/cart';
import { LoginPage } from '../pages/login';

const test = base
  .extend<{ loginPage: LoginPage }>({ loginPage: async ({ page }, use) => { await use(new LoginPage(page)); } })
  .extend<{ cartPage: CartPage }>({ cartPage: async ({ page }, use) => { await use(new CartPage(page)); } });

test('checks out', async ({ loginPage, cartPage }) => {
  await loginPage.submit();
  await cartPage.add('tea');
});
