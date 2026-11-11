import { test } from '../shop-fixtures';

test('adds an item', async ({ loginPage, cartPage, account }) => {
  await loginPage.open();
  await test.step(`add as ${account}`, async () => {
    await cartPage.add('tea');
  });
});

test.skip('empties the cart', async ({ cartPage }) => {
  await cartPage.rows().first().click();
});
