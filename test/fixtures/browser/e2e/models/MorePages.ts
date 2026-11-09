export class CtorPage {
  readonly submit;
  constructor(private page: any) {
    this.submit = page.locator('.submit');
  }
}

export class BasePage {
  constructor(protected page: any) {}
  get baseField() { return this.page.locator('.base-field'); }
}

export class ChildPage extends BasePage {
  get childField() { return this.page.locator('.child-field'); }
}

export class Links implements Iterable<number> {
  page: any;
  [Symbol.iterator]() { return [][Symbol.iterator](); }
  get reportLink() { return this.page.locator('a[href="/files/report.pdf"]'); }
  get valueField() { return this.page.locator('input[value="a.b"].value-field'); }
}
