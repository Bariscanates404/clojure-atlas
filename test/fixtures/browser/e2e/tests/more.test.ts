import { test, expect } from '@playwright/test';
import { ChildPage, CtorPage } from '../models/MorePages';

test.describe.serial('group', () => {
  test('inherited member and soft assertions', async ({ page }) => {
    const p = new ChildPage(page);
    await expect(p.baseField).toBeVisible();
    expect.soft(p.childField).toBeVisible();
    await expect.poll(() => p.baseField.count()).toBe(1);
  });

  test('constructor locator', async ({ page }) => {
    await expect(new CtorPage(page).submit).toBeVisible();
  });
});

test.skip(({ browserName }) => browserName === 'webkit', 'no webkit');
