import { afterEach, describe, expect, it } from 'vitest';
import { param, route, type Route } from '@kinetic-router/definition';
import { AppState } from './app-state.js';
import { reusableRoutes } from './diff.js';
import { createParamStorage } from './params.js';
import { runWithOwner } from 'solid-js';
import { createPageLifecycle, type RenderedRoute } from './rendered-route.js';

const created: RenderedRoute[] = [];

function rendered(definition: Route<any>, values: Record<string, any>, untrackedKeys: string[] = [], parent?: RenderedRoute): RenderedRoute {
  const state = AppState.fromLocator(definition.locate(values));
  const implementation = { untrackedKeys, async render() { return () => ({ html: document.createElement('div'), title: '' }); } };
  const params = createParamStorage({ route: definition, implementation, paramMap: state.paramsByDefinition, parent: parent?.renderArgs.params });
  const lifecycle = runWithOwner(params.owner, createPageLifecycle);
  const result: RenderedRoute = {
    route: definition, implementation, lifecycle,
    renderArgs: { params, pageStatus: lifecycle.status },
    renderOutput: undefined, subOutlet: undefined,
  };
  created.push(result);
  return result;
}

afterEach(() => {
  for (const page of created.splice(0).reverse()) page.renderArgs.params.dispose();
});

describe('reusable route prefixes', () => {
  it('compares parameter values, including structurally equal untracked objects', () => {
    const page = route({ constant: param.hidden<{ id: number }>(), live: param.hidden<number>() });
    const from = [rendered(page, { constant: { id: 1 }, live: 1 }, ['constant'])];
    expect(reusableRoutes(from, AppState.fromLocator(page.locate({ constant: { id: 1 }, live: 1 })))).toEqual(from);
    expect(reusableRoutes(from, AppState.fromLocator(page.locate({ constant: { id: 1 }, live: 2 })))).toEqual(from);
  });

  it('rerenders an untracked owner and all descendants exactly once', () => {
    const parent = route({ id: param.hidden<number>() });
    const child = parent.nestedRoute({});
    const first = rendered(parent, { id: 1 }, ['id']);
    const from = [first, rendered(child, { id: 1 }, [], first)];
    expect(reusableRoutes(from, AppState.fromLocator(child.locate({ id: 2 })))).toEqual([]);
  });

  it('reuses shared reactive values without changing them during planning', () => {
    const parent = route({ id: param.hidden<number>() });
    const child = parent.nestedRoute({});
    const first = rendered(parent, { id: 1 });
    const from = [first, rendered(child, { id: 1 }, [], first)];
    expect(reusableRoutes(from, AppState.fromLocator(child.locate({ id: 2 })))).toEqual(from);
    expect((first.renderArgs.params.reactiveProxyObject as { id: number }).id).toBe(1);
  });

  it('keeps only matching ancestors, including when forcing a new leaf', () => {
    const parent = route({}), child = parent.nestedRoute({}), sibling = parent.nestedRoute({});
    const first = rendered(parent, {});
    const from = [first, rendered(child, {}, [], first)];
    const destination = AppState.fromLocator(child.locate({}));
    expect(reusableRoutes(from, destination, true)).toEqual([first]);
    expect(reusableRoutes(from, AppState.fromLocator(parent.locate({})))).toEqual([first]);
    expect(reusableRoutes(from, AppState.fromLocator(parent.locate({})), true)).toEqual([]);
    expect(reusableRoutes(from, AppState.fromLocator(sibling.locate({})))).toEqual([first]);
    expect(reusableRoutes([first], destination)).toEqual([first]);
    expect(reusableRoutes([], destination)).toEqual([]);
  });
});
