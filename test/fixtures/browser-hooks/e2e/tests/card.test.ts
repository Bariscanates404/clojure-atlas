import { CardPage } from '../models/CardPage';

declare const test: any;
declare const expect: any;

test('card', async ({ page }: { page: any }) => {
  const p = new CardPage(page);
  await expect(p.title()).toBeVisible();
  await expect(p.badge()).toBeVisible();
  await expect(p.plain()).toBeVisible();
  await expect(p.card()).toBeVisible();
});
