import { test as base } from './fixtures';
import { CartPage } from './pages/cart';

// extends the test that fixtures.ts already extended, with a worker fixture beside the page object
export const test = base.extend<{ cartPage: CartPage }, { account: string }>({
  cartPage: async ({ page }, use) => {
    await use(new CartPage(page));
  },
  account: [async ({}, use) => {
    await use('shopper');
  }, { scope: 'worker' }],
});
