import { afterEach, describe, expect, it } from 'vitest';
import { param, route, type Route } from '@kinetic-router/definition';
import { AppState } from './app-state.js';
import { calculateRouteChanges } from './diff.js';
import { createParamStorage } from './params.js';
import type { RenderedRoute } from './rendered-route.js';

const created: RenderedRoute[] = [];

function rendered(definition: Route<any>, values: Record<string, any>, untrackedKeys: string[] = [], parent?: RenderedRoute): RenderedRoute {
  const state = AppState.fromLocator(definition.locate(values));
  const implementation = { untrackedKeys, async render() { return () => ({ html: document.createElement('div'), title: '' }); } };
  const params = createParamStorage({ route: definition, implementation, paramMap: state.paramsByDefinition, parent: parent?.renderArgs.params });
  const result: RenderedRoute = {
    route: definition, implementation, owner: params.owner,
    renderArgs: { params, pageStatus: { shouldFetch: () => true, isVisible: () => true, isAnimating: () => false, hasFocus: () => true } },
    renderOutput: undefined, subFrame: undefined,
  };
  created.push(result);
  return result;
}

afterEach(() => {
  for (const page of created.splice(0).reverse()) page.owner.dispose();
});

describe('route diffing', () => {
  it('compares parameter values, including structurally equal untracked objects', () => {
    const page = route({ constant: param.hidden<{ id: number }>(), live: param.hidden<number>() });
    const from = [rendered(page, { constant: { id: 1 }, live: 1 }, ['constant'])];
    expect(calculateRouteChanges(from, { routes: [page], state: AppState.fromLocator(page.locate({ constant: { id: 1 }, live: 1 })) })).toEqual(['nothing']);
    expect(calculateRouteChanges(from, { routes: [page], state: AppState.fromLocator(page.locate({ constant: { id: 1 }, live: 2 })) })).toEqual(['set-params']);
  });

  it('rerenders an untracked owner and all descendants exactly once', () => {
    const parent = route({ id: param.hidden<number>() });
    const child = parent.nestedRoute({});
    const first = rendered(parent, { id: 1 }, ['id']);
    const from = [first, rendered(child, { id: 1 }, [], first)];
    expect(calculateRouteChanges(from, { routes: [parent, child], state: AppState.fromLocator(child.locate({ id: 2 })) })).toEqual(['render', 'render']);
  });

  it('updates shared reactive values through their owning ancestor', () => {
    const parent = route({ id: param.hidden<number>() });
    const child = parent.nestedRoute({});
    const first = rendered(parent, { id: 1 });
    const from = [first, rendered(child, { id: 1 }, [], first)];
    expect(calculateRouteChanges(from, { routes: [parent, child], state: AppState.fromLocator(child.locate({ id: 2 })) })).toEqual(['set-params', 'nothing']);
  });
});
