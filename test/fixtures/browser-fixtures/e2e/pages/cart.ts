import type { Page } from '@playwright/test';

export class CartPage {
  constructor(private readonly page: Page) {}

  readonly rows = () => this.page.locator('.cart-row');

  async add(item: string) {
    await this.page.locator(`.add-to-cart >> text=${item}`).click();
  }
}
