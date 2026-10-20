import { expect, test as base } from '@playwright/test';

export { expect };

// Every test gets a fresh browser context/history; browser errors must fail it.
export const test = base.extend({
  page: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await use(page);
    expect(errors, 'Unexpected browser errors').toEqual([]);
  },
});
