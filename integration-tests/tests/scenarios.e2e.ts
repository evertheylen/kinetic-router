import { test, expect } from './helpers.js';
import { scenarios } from '../src/scenarios/index.js';
import { instruction } from '../src/scenario.js';

for (const scenario of scenarios) {
  test(scenario.name, async ({ page }) => {
    await page.goto(`/home?scenario=${scenario.id}&checks=manual`);
    const app = page.getByTestId('scenario-app');
    for (const [index, step] of scenario.steps.entries()) {
      await test.step([instruction(step.action), step.intent].filter(Boolean).join(': '), async () => {
        const action = step.action;
        if (action && 'link' in action) await app.getByRole('link', { name: action.link, exact: true }).click();
        if (action && 'button' in action) await app.getByRole('button', { name: action.button, exact: true }).click();
        if (action && 'fill' in action) await app.getByRole('textbox', { name: action.fill, exact: true }).fill(action.value);
        await page.getByRole('button', { name: 'Check step', exact: true }).click();
        await expect(page.getByTestId('result')).toHaveText(
          index + 1 === scenario.steps.length ? '✅ Passed' : `Step ${index + 1} passed`,
        );
      });
    }
  });

  test(`autoplay: ${scenario.name}`, async ({ page }) => {
    await page.goto(`/home?scenario=${scenario.id}`);
    await page.getByRole('button', { name: 'Autoplay', exact: true }).click();
    await expect(page.getByTestId('result')).toHaveText('✅ Passed', { timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Check step', exact: true })).toBeDisabled();
  });
}

test('a settled mismatch fails promptly without advancing; correcting it allows retry', async ({ page }) => {
  await page.goto('/home?scenario=links&checks=manual');
  const notes = page.getByTestId('scenario-app').getByRole('textbox', { name: 'Notes' });
  await notes.fill('Wrong note');
  await page.getByRole('button', { name: 'Check step', exact: true }).click();
  await expect(page.getByTestId('result')).toHaveText('❌ Failed', { timeout: 1000 });
  await expect(page.getByRole('alert')).toHaveText('notes: expected "", got "Wrong note"');
  await notes.fill('');
  await page.getByRole('button', { name: 'Check step', exact: true }).click();
  await expect(page.getByTestId('result')).toHaveText('Step 1 passed');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('the picker opens a scenario in a fresh top-level tab', async ({ page, context }) => {
  await page.goto('/');
  const opened = context.waitForEvent('page');
  await page.getByRole('link', { name: scenarios[0].name, exact: true }).click();
  const run = await opened;
  await expect(run.getByTestId('result')).toHaveText('Step 1 passed');
  expect(await run.evaluate(() => window.opener === null)).toBe(true);
  await run.close();
});

test('Run step performs just the next action', async ({ page }) => {
  await page.goto('/home?scenario=links&checks=manual');
  const runStep = page.getByRole('button', { name: 'Run step', exact: true });
  await runStep.click();
  await expect(page.getByTestId('result')).toHaveText('Step 1 passed');
  await runStep.click();
  await expect(page.getByTestId('result')).toHaveText('Step 2 passed');
  await expect(page.getByTestId('scenario-app').getByRole('textbox', { name: 'Notes' })).toHaveValue('Keep this note');
});

test('a pending render can finish while its check is running', async ({ page }) => {
  await page.goto('/home?scenario=slow&checks=manual');
  const runStep = page.getByRole('button', { name: 'Run step', exact: true });
  await runStep.click();
  await expect(page.getByTestId('result')).toHaveText('Step 1 passed');
  await runStep.click();
  await expect(page.getByTestId('result')).toHaveText('Step 2 passed');
  await page.getByRole('button', { name: 'Check step', exact: true }).click();
  await expect(page.getByTestId('result')).toHaveText('Checking…');
  await page.getByRole('button', { name: 'Finish rendering', exact: true }).click();
  await expect(page.getByTestId('result')).toHaveText('✅ Passed', { timeout: 1000 });
});

test('unexpected navigation reports the actual history mismatch', async ({ page }) => {
  await page.goto('/home?scenario=links&checks=manual');
  await page.getByTestId('scenario-app').getByRole('link', { name: 'About' }).click();
  await page.getByRole('button', { name: 'Check step', exact: true }).click();
  await expect(page.getByTestId('result')).toHaveText('❌ Failed', { timeout: 1000 });
  await expect(page.getByRole('alert')).toContainText('history: expected ["/home"], got ["/home","/about"]');
  await expect(page.getByRole('alert')).toContainText('index: expected 0, got 1');
});

test('the guide highlights interactions and checks them automatically', async ({ page }) => {
  await page.goto('/home?scenario=links');
  const app = page.getByTestId('scenario-app');
  await expect(page.getByTestId('result')).toHaveText('Step 1 passed');
  const notes = app.getByRole('textbox', { name: 'Notes', exact: true });
  await expect(notes).toHaveAttribute('data-scenario-target', 'true');
  await expect(notes).toHaveAttribute('aria-describedby', 'scenario-action-hint');
  await expect(page.getByRole('note')).toHaveText('Enter “Keep this note” in Notes');
  await notes.fill('Keep'); // no failure while still typing
  await expect(page.getByTestId('result')).toHaveText('Step 1 passed');
  await notes.fill('Keep this note');
  await expect(page.getByTestId('result')).toHaveText('Step 2 passed');
  const about = app.getByRole('link', { name: 'About', exact: true });
  await expect(about).toHaveAttribute('data-scenario-target', 'true');
  const expectedStack = page.getByRole('list', { name: 'Expected history stack' });
  await expect(expectedStack.getByRole('listitem')).toContainText(['/home', '/about']);
  await expect(expectedStack.locator('[aria-current="page"]')).toContainText('/about');
  await about.click();
  await expect(page.getByTestId('result')).toHaveText('Step 3 passed');
  const back = app.getByRole('button', { name: 'Back', exact: true });
  await expect(back).toHaveAttribute('data-scenario-target', 'true');
  await back.click();
  await expect(page.getByTestId('result')).toHaveText('Step 4 passed');
  await app.getByRole('button', { name: 'Forward', exact: true }).click();
  await expect(page.getByTestId('result')).toHaveText('✅ Passed');
  await expect(app.locator('[data-scenario-target]')).toHaveCount(0);
});
