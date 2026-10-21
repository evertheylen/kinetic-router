import { expect, it } from 'vitest';
import { param, root, route } from '@kinetic-router/definition';
import { AppState } from './app-state.js';

it('round-trips the transient entry marker without requiring it in older state', () => {
  const page = route({});
  const sitemap = root({ page });
  const state = AppState.fromLocator(page.locate({}), 'entry');
  const ordinary = state.serialize(sitemap);
  expect(ordinary).not.toHaveProperty('$transient');
  expect(AppState.deserialize(sitemap, ordinary).transient).toBe(false);
  state.transient = true;
  expect(state.serialize(sitemap)).toMatchObject({ $transient: true });
  expect(AppState.deserialize(sitemap, state.serialize(sitemap)).serialize(sitemap)).toEqual(state.serialize(sitemap));
});

it('keeps normalized parameter maps, locators and history snapshots consistent', () => {
  const q = param.search<string>().withDefault('all');
  const draft = param.hidden<string>().withDefault('new');
  const results = route({ q, draft });
  const sitemap = root({ results });
  const state = AppState.fromLocator({ route: results, values: {} }, 'entry');
  expect(state.paramsByDefinition.get(q)).toBe('all');
  expect(state.paramsByDefinition.get(draft)).toBe('new');
  expect(state.locator.values).toEqual({ q: 'all', draft: 'new' });
  expect(state.serialize(sitemap).snapShotByKey).toEqual(state.locator.values);

  // State written before defaults were normalized still restores consistently.
  const restored = AppState.deserialize(sitemap, { ...state.serialize(sitemap), snapShotByKey: {} });
  expect(restored.locator.values).toEqual(state.locator.values);
  expect(restored.serialize(sitemap).snapShotByKey).toEqual(state.locator.values);
  expect(restored.id).toBe('entry');
});
