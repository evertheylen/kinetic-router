import { describe, expect, it, vi } from 'vitest';
import { index, param, root, route, type Locator, type Route } from '@kinetic-router/definition';
import { createEffect, createOwner, runWithOwner, useContext } from 'solid-js';
import { Router } from './router.js';
import { MemoryEngine } from './memory-engine.js';
import { frameDelegateAttribute, rootFrameId, type FrameDelegate } from './frame.js';
import { InRenderedRoute } from './rendered-route.js';

async function createApp(initialUrl = '/b', slow?: Promise<void>, engine = new MemoryEngine(initialUrl)) {
  const home = route({}), a = route({}), x = route({}), b = route({}), ab = route({});
  // Layout ancestry deliberately disagrees with URL ancestry.
  const detail = b.nestedRoute({}), other = route({});
  const projectId = param.path<{ id: number, label?: string }>({
    serialize: value => value.id,
    deserialize: value => ({ id: Number(value) }),
  });
  const project = route({ projectId });
  const projectDetail = route({ id: projectId, query: param.search<string>().optional(), draft: param.hidden<string>() });
  const alias = route({}).aliasTo(() => x.locate({}));
  const sitemap = root({
    [index]: home,
    a: { [index]: a, x: { [index]: x, detail }, other },
    b, ab, alias,
    projects: { [projectId.$]: { [index]: project, detail: projectDetail } },
  });
  const routes = { home, a, x, detail, other, b, ab, project, projectDetail };
  const router = new Router(sitemap, { engine, maxCachedPages: 0 });
  const renders = vi.fn();
  for (const [name, route] of Object.entries<Route<any>>(routes)) {
    router.implement(route, {
      untrackedKeys: [],
      async render() {
        renders(name);
        if (name === 'detail' && slow) await slow;
        return () => {
          const html = document.createElement('section');
          html.textContent = name;
          if (name === 'b') {
            const rendered = useContext(InRenderedRoute)!;
            const outlet = document.createElement('div');
            html.append(outlet);
            rendered.subFrame = { setElement: node => outlet.replaceChildren(node), clear: () => outlet.replaceChildren() };
          }
          return { html, title: name };
        };
      },
    });
  }
  const el = document.createElement('div');
  el.id = rootFrameId;
  const frame: FrameDelegate = { setElement: node => el.replaceChildren(node), clear: () => el.replaceChildren() };
  Object.assign(el, { [frameDelegateAttribute]: frame });
  document.body.replaceChildren(el);
  await vi.waitFor(() => expect(router.currentLocator()).toBeDefined());
  const menu = (locator: Locator<any>) => router.navigate(locator, { mode: 'menu' });
  return { router, engine, routes, alias, menu, renders };
}

describe('destination resolution and menu navigation', () => {
  it('pushes and replaces exact destinations, including equal URLs', async () => {
    const { router, engine, routes } = await createApp();
    await router.navigate(routes.b.locate({})).finished;
    expect(engine.entries().map(e => e.url)).toEqual(['/b', '/b']);
    const key = engine.currentEntry().key, id = engine.currentEntry().id;
    expect(router.resolveDestination(routes.a.locate({}), 'replace').operation.type).toBe('replace');
    await router.navigate(routes.a.locate({}), { mode: 'replace' }).finished;
    expect(engine.currentEntry().key).toBe(key);
    expect(engine.currentEntry().id).not.toBe(id);
    await router.navigate(routes.x.locate({}), { mode: 'replace' }).finished;
    expect(engine.entries().map(e => e.url)).toEqual(['/b', '/a/x']);
  });

  it('pushes an unvisited root, then does nothing at that root', async () => {
    const { router, engine, routes, menu, renders } = await createApp();
    const root = routes.a.locate({});
    expect(router.resolveDestination(root, 'menu')).toMatchObject({ url: '/a', operation: { type: 'push' } });
    await menu(root).finished;
    const id = engine.currentEntry().id, count = renders.mock.calls.length;
    expect(router.resolveDestination(root, 'menu').operation.type).toBe('no-op');
    await menu(root).finished;
    expect(engine.currentEntry().id).toBe(id);
    expect(engine.entries()).toHaveLength(2);
    expect(renders).toHaveBeenCalledTimes(count);
  });

  it('replaces a descendant with the root when no preceding root survives', async () => {
    const { router, engine, routes, menu } = await createApp('/a/x/detail');
    const key = engine.currentEntry().key;
    expect(router.resolveDestination(routes.a.locate({}), 'menu').operation.type).toBe('replace');
    await menu(routes.a.locate({})).finished;
    expect(engine.entries().map(e => e.url)).toEqual(['/a']);
    expect(engine.currentEntry().key).toBe(key);
  });

  it('replaces rather than traversing to a root that exists only in forward history', async () => {
    const { router, engine, routes, menu } = await createApp('/a/x/detail');
    await router.navigate(routes.a.locate({})).finished;
    const forward = engine.currentEntry();
    await engine.back().finished;
    expect(router.resolveDestination(routes.a.locate({}), 'menu').operation.type).toBe('replace');
    await menu(routes.a.locate({})).finished;
    expect(engine.entries().map(entry => entry.url)).toEqual(['/a', '/a']);
    expect(engine.currentIndex()).toBe(0);
    expect(engine.entries()[1].id).toBe(forward.id);
  });

  it('traverses to the nearest preceding root, not the oldest root or a forward root', async () => {
    const { router, engine, routes, menu } = await createApp('/a');
    await router.navigate(routes.detail.locate({})).finished;
    await router.navigate(routes.a.locate({})).finished;
    const nearest = engine.currentEntry();
    await router.navigate(routes.other.locate({})).finished;
    await router.navigate(routes.a.locate({})).finished;
    await engine.back().finished;
    expect(router.resolveDestination(routes.a.locate({}), 'menu').operation).toEqual({
      type: 'traverse', id: nearest.id, key: nearest.key,
    });
    await menu(routes.a.locate({})).finished;
    expect(engine.currentIndex()).toBe(2);
    expect(engine.entries()).toHaveLength(5);
  });

  it('uses the last committed Back/Forward visit, not the highest or deepest entry', async () => {
    const { router, engine, routes, menu } = await createApp();
    await router.navigate(routes.detail.locate({})).finished;
    const detail = engine.currentEntry();
    await router.navigate(routes.other.locate({})).finished;
    const other = engine.currentEntry();
    await router.navigate(routes.b.locate({})).finished;
    await engine.back().finished;
    await engine.back().finished;
    await engine.back().finished;
    expect(router.resolveDestination(routes.a.locate({}), 'menu').operation).toMatchObject({ id: detail.id });
    // A menu resume can go forward and must not prune the remaining branch.
    await menu(routes.a.locate({})).finished;
    expect(engine.currentEntry().id).toBe(detail.id);
    expect(engine.entries()).toHaveLength(4);
    await engine.forward().finished;
    await engine.forward().finished;
    expect(router.resolveDestination(routes.a.locate({}), 'menu').operation).toMatchObject({ id: other.id });
    await menu(routes.a.locate({})).finished;
    expect(engine.currentEntry().id).toBe(other.id);
    expect(engine.entries()).toHaveLength(4);
  });

  it('updates a parent bookmark at its root without clearing a child bookmark', async () => {
    const { router, engine, routes, menu } = await createApp('/a');
    const a = engine.currentEntry();
    await router.navigate(routes.detail.locate({})).finished;
    const detail = engine.currentEntry();
    await router.navigate(routes.b.locate({})).finished;
    await menu(routes.a.locate({})).finished; // resume detail
    await menu(routes.a.locate({})).finished; // return to root
    expect(engine.currentEntry().id).toBe(a.id);
    await menu(routes.b.locate({})).finished; // forward, preserving both
    expect(router.resolveDestination(routes.a.locate({}), 'menu').operation).toMatchObject({ id: a.id });
    expect(router.resolveDestination(routes.x.locate({}), 'menu').operation).toMatchObject({ id: detail.id });
    await menu(routes.x.locate({})).finished;
    expect(engine.currentEntry().id).toBe(detail.id);
  });

  it('uses URL ancestry rather than layout nesting or string prefixes', async () => {
    const { router, engine, routes, menu } = await createApp('/a/x/detail');
    // The detail page's layout is B, but its URL is below A and X, not B.
    expect(router.resolveDestination(routes.a.locate({}), 'menu').operation.type).toBe('replace');
    expect(router.resolveDestination(routes.b.locate({}), 'menu').operation.type).toBe('push');
    await router.navigate(routes.ab.locate({})).finished;
    expect(router.resolveDestination(routes.a.locate({}), 'menu')).toMatchObject({
      url: '/a/x/detail', operation: { type: 'traverse' },
    });
    await menu(routes.a.locate({})).finished;
    expect(engine.currentIndex()).toBe(0);
  });

  it('keeps structurally identical Route objects as distinct bookmark roots', async () => {
    const { router, engine, routes } = await createApp();
    const b = engine.currentEntry();
    await router.navigate(routes.other.locate({})).finished;
    const other = engine.currentEntry();
    await router.navigate(routes.ab.locate({})).finished;
    expect(router.resolveDestination(routes.a.locate({}), 'menu').operation).toMatchObject({ id: other.id });
    expect(router.resolveDestination(routes.b.locate({}), 'menu').operation).toMatchObject({ id: b.id });
  });

  it('handles the sitemap index as a navigable root with an empty slug path', async () => {
    const { router, engine, routes, menu } = await createApp('/');
    expect(router.resolveDestination(routes.home.locate({}), 'menu').operation.type).toBe('no-op');
    await router.navigate(routes.detail.locate({})).finished;
    expect(router.resolveDestination(routes.home.locate({}), 'menu').url).toBe('/');
    await menu(routes.home.locate({})).finished;
    expect(engine.currentIndex()).toBe(0);
    expect(engine.entries()).toHaveLength(2);
  });

  it('distinguishes dynamic path instances, reuses serde rules and preserves full resumed values', async () => {
    const { router, engine, routes, menu } = await createApp();
    const one = routes.project.locate({ projectId: { id: 1 } });
    const two = routes.project.locate({ projectId: { id: 2 } });
    await router.navigate(routes.projectDetail.locate({ id: { id: 1 }, query: 'recent', draft: 'private' })).finished;
    const detail = engine.currentEntry();
    expect(router.resolveDestination(one, 'menu').operation.type).toBe('replace');
    expect(router.resolveDestination(two, 'menu')).toMatchObject({ url: '/projects/2', operation: { type: 'push' } });
    await router.navigate(routes.projectDetail.locate({ id: { id: 2 }, draft: 'second' })).finished;
    await router.navigate(routes.b.locate({})).finished;
    const plan = router.resolveDestination(one, 'menu');
    expect(plan).toMatchObject({
      url: '/projects/1/detail?query=recent', operation: { id: detail.id, key: detail.key },
      locator: { values: { id: { id: 1 }, query: 'recent', draft: 'private' } },
    });
    await menu(one).finished;
    expect(router.currentLocator()?.values).toEqual({ id: { id: 1 }, query: 'recent', draft: 'private' });
  });

  it('matches custom path values by their URL meaning rather than incidental object properties', async () => {
    const { router, engine, routes } = await createApp();
    await router.navigate(routes.projectDetail.locate({ id: { id: 1, label: 'visited' }, draft: 'private' })).finished;
    const visited = engine.currentEntry();
    await router.navigate(routes.b.locate({})).finished;
    const plan = router.resolveDestination(routes.project.locate({ projectId: { id: 1, label: 'requested' } }), 'menu');
    expect(plan.operation).toMatchObject({ type: 'traverse', id: visited.id });
    expect(plan.locator.values.id).toEqual({ id: 1, label: 'visited' });
  });

  it('rejects replaced bookmarks even when their traversal key survives', async () => {
    const { router, engine, routes } = await createApp('/a/x/detail');
    const old = engine.currentEntry();
    const navigation = router.navigate(routes.b.locate({}), { mode: 'replace' });
    // Disposal is asynchronous: reject the old id before handleDispose runs.
    expect(router.resolveDestination(routes.a.locate({}), 'menu').operation.type).toBe('push');
    await navigation.finished;
    expect(engine.currentEntry().key).toBe(old.key);
    expect(engine.currentEntry().id).not.toBe(old.id);
    expect(router.resolveDestination(routes.a.locate({}), 'menu')).toMatchObject({ url: '/a', operation: { type: 'push' } });
  });

  it('keeps a replacement bookmark in the same subtree when the old id is disposed', async () => {
    const { router, engine, routes, menu } = await createApp('/a/x/detail');
    await router.navigate(routes.other.locate({}), { mode: 'replace' }).finished;
    const replacement = engine.currentEntry();
    await router.navigate(routes.b.locate({})).finished;
    expect(router.resolveDestination(routes.a.locate({}), 'menu').operation).toMatchObject({ id: replacement.id });
    await menu(routes.a.locate({})).finished;
    expect(engine.currentEntry().id).toBe(replacement.id);
  });

  it('uses only entries exposed by the engine and validates surviving destinations', async () => {
    const { router, engine, routes } = await createApp();
    await router.navigate(routes.detail.locate({})).finished;
    const detail = engine.currentEntry();
    await router.navigate(routes.b.locate({})).finished;
    const entries = engine.entries();
    const view = vi.spyOn(engine, 'entries');
    try {
      view.mockReturnValue(entries.filter(entry => entry.id !== detail.id));
      expect(router.resolveDestination(routes.a.locate({}), 'menu').operation.type).toBe('push');
      // Even a surviving id/key must still identify a destination in A.
      for (const url of ['/b', '/unknown']) {
        view.mockReturnValue(entries.map(entry => entry.id === detail.id
          ? { ...entry, url, getState: () => undefined } : entry));
        expect(router.resolveDestination(routes.a.locate({}), 'menu').operation.type).toBe('push');
      }
    } finally { view.mockRestore(); }
    expect(router.resolveDestination(routes.a.locate({}), 'menu').operation).toMatchObject({ id: detail.id });
  });

  it('keeps equal-URL history instances and their hidden values distinct', async () => {
    const { router, engine, routes, menu } = await createApp();
    await router.navigate(routes.projectDetail.locate({ id: { id: 1 }, draft: 'first' })).finished;
    const first = engine.currentEntry();
    await router.navigate(routes.projectDetail.locate({ id: { id: 1 }, draft: 'second' })).finished;
    await router.navigate(routes.b.locate({})).finished;
    await engine.back().finished;
    await engine.back().finished;
    await menu(routes.b.locate({})).finished;
    const plan = router.resolveDestination(routes.project.locate({ projectId: { id: 1 } }), 'menu');
    expect(plan.operation).toMatchObject({ id: first.id });
    expect(plan.locator.values.draft).toBe('first');
    await router.activateDestination(plan).finished;
    expect(router.currentLocator()?.values.draft).toBe('first');
  });

  it('rejects pruned bookmarks and revalidates stale activation plans', async () => {
    const { router, engine, routes } = await createApp();
    await router.navigate(routes.detail.locate({})).finished;
    await engine.back().finished;
    const stale = router.resolveDestination(routes.a.locate({}), 'menu');
    expect(stale.operation.type).toBe('traverse');
    await router.navigate(routes.ab.locate({})).finished; // discards detail
    await router.activateDestination(stale).finished;
    expect(engine.entries().map(e => e.url)).toEqual(['/b', '/ab', '/a']);
  });

  it('revalidates the original root against new bookmarks and the current location', async () => {
    const { router, engine, routes } = await createApp('/a');
    await router.navigate(routes.detail.locate({})).finished;
    await router.navigate(routes.b.locate({})).finished;
    const stale = router.resolveDestination(routes.a.locate({}), 'menu');
    await router.navigate(routes.other.locate({})).finished;
    // Now inside A: activation returns to its preceding root, not stale detail.
    await router.activateDestination(stale).finished;
    expect(engine.currentIndex()).toBe(0);
    await engine.traverseTo(engine.entries()[2].key).finished;
    expect(router.resolveDestination(routes.a.locate({}), 'menu').url).toBe('/a');
    await router.activateDestination(stale).finished;
    expect(engine.currentIndex()).toBe(0);
  });

  it('resolves aliases before matching, href generation and activation', async () => {
    const { router, engine, routes, alias, menu } = await createApp('/a/x/detail');
    const target = { route: alias, values: {} }; // deliberately bypass Alias.locate
    expect(router.toUrl(target)).toBe('/a/x');
    const plan = router.resolveDestination(target, 'menu');
    expect(plan).toMatchObject({ url: '/a/x', operation: { type: 'replace' } });
    await menu(target).finished;
    expect(router.currentLocator()?.route).toBe(routes.x);
    await router.navigate(routes.b.locate({})).finished;
    await router.activateDestination(plan).finished;
    expect(engine.currentIndex()).toBe(0);
    expect(router.currentLocator()?.route).toBe(routes.x);
  });

  it('re-resolves aliases and changed path values when an old plan activates', async () => {
    const { router, routes } = await createApp();
    let id = 1;
    const alias = route({}).aliasTo(() => routes.project.locate({ projectId: { id } }));
    const plan = router.resolveDestination({ route: alias, values: {} });
    expect(plan.url).toBe('/projects/1');
    id = 2;
    await router.activateDestination(plan).finished;
    expect(router.currentLocator()?.values).toEqual({ projectId: { id: 2 } });
  });

  it('records visits at commit, not after rendering, and resolution itself has no side effects', async () => {
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const { router, engine, routes, renders } = await createApp('/b', gate);
    const navigation = router.navigate(routes.detail.locate({}));
    const outcome = Promise.resolve(navigation.finished).catch((error: unknown) => error);
    try {
      await navigation.committed;
      expect(router.currentLocator()?.route).toBe(routes.b); // rendering still pending
      expect(router.resolveDestination(routes.a.locate({}), 'menu').operation.type).toBe('replace');
      await router.navigate(routes.b.locate({})).finished;
      expect(router.resolveDestination(routes.a.locate({}), 'menu').url).toBe('/a/x/detail');
      const entries = () => engine.entries().map(({ id, key, index, url, state }) => ({ id, key, index, url, state }));
      const before = entries(), count = renders.mock.calls.length, title = document.title;
      router.resolveDestination(routes.x.locate({}), 'menu');
      router.resolveDestination(routes.project.locate({ projectId: { id: 7 } }));
      expect(entries()).toEqual(before);
      expect(renders).toHaveBeenCalledTimes(count);
      expect(document.title).toBe(title);
      await router.navigate(routes.other.locate({})).finished;
      await router.navigate(routes.b.locate({})).finished;
      finish();
      await outcome;
      expect(router.resolveDestination(routes.a.locate({}), 'menu').url).toBe('/a/other');
    } finally { finish(); await outcome; }
  });

  it('invalidates reactive resolutions on commit, before rendering completes', async () => {
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const { router, routes } = await createApp('/b', gate);
    const owner = createOwner();
    const operations: string[] = [];
    runWithOwner(owner, () => createEffect(
      () => router.resolveDestination(routes.a.locate({}), 'menu').operation.type,
      operation => { operations.push(operation); },
    ));
    await vi.waitFor(() => expect(operations.at(-1)).toBe('push'));
    const navigation = router.navigate(routes.detail.locate({}));
    try {
      await navigation.committed;
      await vi.waitFor(() => expect(operations.at(-1)).toBe('replace'));
    } finally { finish(); await navigation.finished; owner.dispose(); }
  });
});
