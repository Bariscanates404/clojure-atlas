export class BasePage {
  constructor(readonly page: any) {}
}

export class LoginPage extends BasePage {
  readonly form = () => this.page.locator('.login-form');
  readonly username = () => this.form().locator('.username');
  readonly password = () => this.page.locator('input.password');
  readonly submit = () => this.page.getByTestId('submit');
  readonly byName = (name: string) => this.page.locator(`.user-${name}`);

  async logIn(user: string, pass: string) {
    await this.username().fill(user);
    await this.password().fill(pass);
    await this.submit().click();
  }
}
