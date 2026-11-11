import type { Page } from '@playwright/test';

export class LoginPage {
  constructor(private readonly page: Page) {}

  readonly form = () => this.page.locator('.login-form');
  readonly error = () => this.page.getByTestId('login-error');

  async open() {
    await this.page.goto('/login');
  }

  async submit() {
    await this.form().locator('.submit').click();
  }
}
