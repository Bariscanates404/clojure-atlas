import { LoginPage } from '../models/LoginPage';

declare const test: any;
declare const expect: any;

test.describe('login', () => {
  test('shows the form', async ({ page }: { page: any }) => {
    const login = new LoginPage(page);
    await expect(login.form()).toBeVisible();
    await expect(login.submit()).not.toBeDisabled();
  });

  test('names fields', async ({ page }: { page: any }) => {
    const { username, password: pw } = new LoginPage(page);
    await expect(username()).toBeEditable();
    await pw().fill('x');
  });

  for (const user of ['a', 'b']) {
    test(`logs in as ${user}`, async ({ page }: { page: any }) => {
      await new LoginPage(page).logIn(user, 'x');
    });
  }

  test('logs in', async ({ page }: { page: any }) => {
    const login = new LoginPage(page);
    await login.logIn('a', 'b');
  });
});
