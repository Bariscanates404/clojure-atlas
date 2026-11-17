export class CardPage {
  constructor(readonly page: any) {}
  readonly title = () => this.page.locator('.qa-card-title');
  readonly badge = () => this.page.locator('.qa-badge');
  readonly plain = () => this.page.locator('.qa-plain');
  readonly card = () => this.page.locator('.card');
}
