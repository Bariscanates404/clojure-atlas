import { mergeTests, test as base } from '@playwright/test';
import { CartPage } from '../pages/cart';
import { test as loginTest } from '../fixtures';

const cartTest = base.extend<{ cartPage: CartPage }>({ cartPage: async ({ page }, use) => { await use(new CartPage(page)); } });
const test = mergeTests(loginTest, cartTest);

test('buys as a member', async ({ loginPage, cartPage }) => {
  await loginPage.open();
  await cartPage.add('tea');
});
