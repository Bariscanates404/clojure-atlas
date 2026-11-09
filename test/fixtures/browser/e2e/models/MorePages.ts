export class CtorPage {
  readonly submit;
  constructor(private page: any) {
    this.submit = page.locator('.qa-submit');
  }
}

export class BasePage {
  constructor(protected page: any) {}
  get qaBase() { return this.page.locator('.qa-base'); }
}

export class ChildPage extends BasePage {
  get qaChild() { return this.page.locator('.qa-child'); }
}

export class Links implements Iterable<number> {
  page: any;
  [Symbol.iterator]() { return [][Symbol.iterator](); }
  get qaLink() { return this.page.locator('a[href="/files/report.pdf"]'); }
  get qaValue() { return this.page.locator('input[value="a.b"].qa-value'); }
}
