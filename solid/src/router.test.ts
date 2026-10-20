// End-to-end tests of Router/ActualRouter running headlessly (happy-dom)
// on top of a MemoryEngine. Pages are implemented with plain DOM nodes, and
// the root Frame is replaced by a hand-made frame delegate, so no JSX or
// Solid rendering setup is needed.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { param, route, root } from '@kinetic-router/definition';
import { onCleanup, useContext } from 'solid-js';

import { Router } from './router.js';
import { MemoryEngine, type MemoryEntry } from './memory-engine.js';
import { FrameDelegate, frameDelegateAttribute, rootFrameId } from './frame.js';
import { InRenderedRoute, type RenderedRoute } from './rendered-route.js';

function installRootFrame() {
  const el = document.createElement('div');
  el.id = rootFrameId;

  const delegate: FrameDelegate = {
    setElement(element) { el.replaceChildren(element); },
    clear() { el.replaceChildren(); },
  };
  (el as any)[frameDelegateAttribute] = delegate;

  document.body.replaceChildren(el);
  return el;
}

function createApp(initialUrl: string, maxCachedPages?: number) {
  const userId = param.path<string>();
  const home = route({});
  const user = route({ userId });

  const sitemap = root({
    home,
    users: { [userId.$]: user },
  });

  const engine = new MemoryEngine(initialUrl);
  const router = new Router(sitemap, { engine, maxCachedPages });

  const counters = { home: 0, user: 0 };
  const cleanups = { home: 0, user: 0 };
  let lastUserParams: { userId: string } | undefined;

  router.implement(home, {
    untrackedKeys: [],
    async render() {
      counters.home++;
      return () => {
        const html = document.createElement('div');
        html.textContent = 'home page';
        onCleanup(() => cleanups.home++);
        return { html, title: 'Home' };
      };
    },
  });

  router.implement(user, {
    untrackedKeys: [],
    async render() {
      counters.user++;
      return (params: { userId: string }) => {
        lastUserParams = params;
        onCleanup(() => cleanups.user++);
        const html = document.createElement('div');
        html.textContent = `user ${params.userId}`;
        return { html, title: 'User' };
      };
    },
  });

  const frame = installRootFrame();

  const ready = vi.waitFor(() => {
    if (router.currentLocator() === undefined) {
      throw new Error('router not initialized yet');
    }
  });

  return {
    router, engine, frame, counters, cleanups, ready,
    routes: { home, user },
    getUserParams: () => lastUserParams,
  };
}

function createNestedApp(
  maxCachedPages: number,
  engine = new MemoryEngine('/nested/alpha'),
  betaReady?: Promise<void>,
) {
  const outer = route({});
  const layout = outer.nestedRoute({});
  const alpha = layout.nestedRoute({}), beta = layout.nestedRoute({});
  const outside = route({});
  const routes = { outer, layout, alpha, beta, outside };
  type Name = keyof typeof routes;
  const sitemap = root({ nested: { alpha, beta }, outside });
  const router = new Router(sitemap, { engine, maxCachedPages });
  const counters = { outer: 0, layout: 0, alpha: 0, beta: 0, outside: 0 };
  const cleanups = { ...counters };
  const rendered: Partial<Record<Name, RenderedRoute>> = {};

  for (const name of ['outer', 'layout', 'alpha', 'beta', 'outside'] as const) {
    router.implement(routes[name], {
      untrackedKeys: [],
      async render() {
        counters[name]++;
        if (name === 'beta' && betaReady !== undefined) await betaReady;
        return () => {
          const current = useContext(InRenderedRoute);
          if (current === null) throw new Error('Missing rendered route context');
          rendered[name] = current;
          onCleanup(() => cleanups[name]++);
          const html = document.createElement('section');
          html.dataset.page = name;
          html.append(name);
          if (name === 'outer' || name === 'layout') {
            const outlet = document.createElement('div');
            html.append(outlet);
            current.subFrame = {
              setElement(element) { outlet.replaceChildren(element); },
              clear() { outlet.replaceChildren(); },
            };
          }
          return { html, title: name };
        };
      },
    });
  }

  const frame = installRootFrame();
  const ready = vi.waitFor(() => expect(router.currentLocator()).toBeDefined());
  return { router, engine, routes, frame, counters, cleanups, rendered, ready };
}

describe('Router on a MemoryEngine', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('renders the initial route on init', async () => {
    const app = createApp('/home');
    await app.ready;

    expect(app.frame.textContent).toBe('home page');
    expect(app.router.currentLocator()?.route).toBe(app.routes.home);
    expect(app.counters).toEqual({ home: 1, user: 0 });

    // init normalizes the url via a replace navigation
    expect(app.engine.entries()).toHaveLength(1);
    expect(app.engine.entries()[0].url).toBe('/home');
  });

  it('navigates to another route', async () => {
    const app = createApp('/home');
    await app.ready;

    const res = app.router.navigate(app.routes.user.locate({ userId: 'alice' }));
    await res.finished;

    expect(app.frame.textContent).toBe('user alice');
    expect(app.router.currentLocator()?.route).toBe(app.routes.user);
    expect(app.router.currentLocator()?.values).toEqual({ userId: 'alice' });
    expect(app.engine.entries().map(e => e.url)).toEqual(['/home', '/users/alice']);

    await vi.waitFor(() => expect(document.title).toBe('User'));
  });

  it('reuses the rendered page when only params change (set-params)', async () => {
    const app = createApp('/home');
    await app.ready;

    await app.router.navigate(app.routes.user.locate({ userId: 'alice' })).finished;
    const aliceNode = app.frame.firstChild;
    expect(app.counters.user).toBe(1);

    await app.router.navigate(app.routes.user.locate({ userId: 'bob' })).finished;

    // same rendered instance: not re-rendered, same DOM node, new param value
    expect(app.counters.user).toBe(1);
    expect(app.frame.firstChild).toBe(aliceNode);
    expect(app.getUserParams()!.userId).toBe('bob');
    expect(app.router.currentLocator()?.values).toEqual({ userId: 'bob' });
  });

  it('re-renders when forceNewInstance is set', async () => {
    const app = createApp('/home');
    await app.ready;

    await app.router.navigate(app.routes.user.locate({ userId: 'alice' })).finished;
    const aliceNode = app.frame.firstChild;

    await app.router.navigate(
      app.routes.user.locate({ userId: 'alice' }),
      { forceNewInstance: true }
    ).finished;

    expect(app.counters.user).toBe(2);
    expect(app.frame.firstChild).not.toBe(aliceNode);
  });

  it('restores cached pages when traversing back and forward', async () => {
    const app = createApp('/home');
    await app.ready;
    const homeNode = app.frame.firstChild;

    await app.router.navigate(app.routes.user.locate({ userId: 'alice' })).finished;
    const userNode = app.frame.firstChild;

    await app.engine.back().finished;
    expect(app.frame.textContent).toBe('home page');
    expect(app.frame.firstChild).toBe(homeNode);
    expect(app.router.currentLocator()?.route).toBe(app.routes.home);

    await app.engine.forward().finished;
    expect(app.frame.textContent).toBe('user alice');
    expect(app.frame.firstChild).toBe(userNode);

    // neither page was rendered again
    expect(app.counters).toEqual({ home: 1, user: 1 });
  });

  it('replace navigation does not grow the history stack', async () => {
    const app = createApp('/home');
    await app.ready;

    await app.router.navigate(
      app.routes.user.locate({ userId: 'alice' }),
      { replace: true }
    ).finished;

    expect(app.engine.entries().map(e => e.url)).toEqual(['/users/alice']);
    expect(app.frame.textContent).toBe('user alice');
  });

  it('keeps working after a pruned entry is disposed', async () => {
    const app = createApp('/home');
    await app.ready;

    await app.router.navigate(app.routes.user.locate({ userId: 'alice' })).finished;
    await app.engine.back().finished;

    // pushing from here prunes (and disposes) the /users/alice entry
    await app.router.navigate(app.routes.user.locate({ userId: 'bob' })).finished;

    expect(app.engine.entries().map(e => e.url)).toEqual(['/home', '/users/bob']);
    expect(app.frame.textContent).toBe('user bob');

    await app.engine.back().finished;
    expect(app.frame.textContent).toBe('home page');
  });
});

describe('bounded page caching', () => {
  it.each([-1, 0.5, NaN, Infinity])('validates maxCachedPages synchronously: %s', maxCachedPages => {
    expect(() => new Router(root({ home: route({}) }), { maxCachedPages })).toThrow(RangeError);
  });

  it.each([0, 1])('re-renders evicted entries without deleting history (budget %s)', async limit => {
    const app = createApp('/home', limit);
    await app.ready;
    const originalHome = app.frame.firstChild;
    await app.router.navigate(app.routes.user.locate({ userId: 'alice' })).finished;
    expect(app.cleanups).toEqual({ home: 1, user: 0 });
    expect(originalHome?.parentNode).toBeNull();
    const originalUser = app.frame.firstChild;

    await app.engine.back().finished;
    expect(app.frame.textContent).toBe('home page');
    expect(app.frame.firstChild).not.toBe(originalHome);
    expect(app.cleanups).toEqual({ home: 1, user: 1 });
    await app.engine.forward().finished;
    expect(app.frame.textContent).toBe('user alice');
    expect(app.frame.firstChild).not.toBe(originalUser);
    expect(app.router.currentLocator()?.values).toEqual({ userId: 'alice' });
    expect(app.counters).toEqual({ home: 2, user: 2 });
    expect(app.engine.entries().map(entry => entry.url)).toEqual(['/home', '/users/alice']);
  });

  it('does not dispose a page reused by a newer entry when its older index is evicted', async () => {
    const app = createApp('/home', 1);
    await app.ready;
    await app.router.navigate(app.routes.user.locate({ userId: 'alice' })).finished;
    const node = app.frame.firstChild;
    await app.router.navigate(app.routes.user.locate({ userId: 'bob' })).finished;
    expect(app.frame.firstChild).toBe(node);
    expect(app.cleanups.user).toBe(0);

    await app.engine.back().finished;
    expect(app.frame.firstChild).not.toBe(node);
    expect(app.router.currentLocator()?.values).toEqual({ userId: 'alice' });
    expect(app.cleanups.user).toBe(1);
  });

  it('preserves hidden params and scroll state in history after eviction', async () => {
    const home = route({}), detail = route({ draft: param.hidden<string>() });
    const engine = new MemoryEngine('/home');
    const router = new Router(root({ home, detail }), { engine, maxCachedPages: 1 });
    const implementation = {
      untrackedKeys: [] as const,
      async render() {
        return () => ({ html: document.createElement('div'), title: '' });
      },
    };
    router.implement(home, implementation);
    router.implement(detail, implementation);
    installRootFrame();
    await vi.waitFor(() => expect(router.currentLocator()?.route).toBe(home));
    await router.navigate(detail.locate({ draft: 'unsent text' })).finished;
    const scrollY = vi.spyOn(window, 'scrollY', 'get').mockReturnValue(123);
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    try {
      await router.navigate(home.locate({})).finished;
      await engine.back().finished;
      expect(router.currentLocator()?.values).toEqual({ draft: 'unsent text' });
      expect(scrollTo).toHaveBeenLastCalledWith(0, 123);
    } finally {
      scrollY.mockRestore();
      scrollTo.mockRestore();
    }
  });

  it('retains a cached child together with both ancestors while evicting its older sibling', async () => {
    const app = createNestedApp(4);
    await app.ready;
    const outerNode = app.frame.firstChild;
    await app.router.navigate(app.routes.beta.locate({})).finished;
    const betaNode = app.frame.querySelector('[data-page="beta"]');
    // A newly rendered child must inherit the reused parent's storage and owner.
    expect(app.rendered.beta?.renderArgs.params.parent).toBe(app.rendered.layout?.renderArgs.params);
    await app.router.navigate(app.routes.outside.locate({})).finished;
    expect(app.cleanups).toEqual({ outer: 0, layout: 0, alpha: 1, beta: 0, outside: 0 });

    await app.engine.back().finished;
    expect(app.frame.firstChild).toBe(outerNode);
    expect(app.frame.querySelector('[data-page="beta"]')).toBe(betaNode);
    expect(app.counters).toEqual({ outer: 1, layout: 1, alpha: 1, beta: 1, outside: 1 });

    await app.engine.back().finished;
    expect(app.frame.firstChild).not.toBe(outerNode);
    expect(app.frame.querySelector('[data-page="alpha"]')).not.toBeNull();
    expect(app.counters).toEqual({ outer: 2, layout: 2, alpha: 2, beta: 1, outside: 1 });
    expect(app.cleanups).toEqual({ outer: 1, layout: 1, alpha: 1, beta: 1, outside: 1 });
    expect(app.engine.entries()).toHaveLength(3);
  });

  it('keeps an oversized visible stack, then disposes all of it when navigating away', async () => {
    const app = createNestedApp(1);
    await app.ready;
    expect(app.cleanups).toEqual({ outer: 0, layout: 0, alpha: 0, beta: 0, outside: 0 });
    await app.router.navigate(app.routes.outside.locate({})).finished;
    expect(app.cleanups).toEqual({ outer: 1, layout: 1, alpha: 1, beta: 0, outside: 0 });
    await app.engine.back().finished;
    expect(app.counters).toEqual({ outer: 2, layout: 2, alpha: 2, beta: 0, outside: 1 });
    expect(app.cleanups).toEqual({ outer: 1, layout: 1, alpha: 1, beta: 0, outside: 1 });
  });

  it('protects displayed ancestors when disposal precedes a slow replacement render', async () => {
    class ImmediateDisposeEngine extends MemoryEngine {
      protected override disposeAfter(_finished: Promise<unknown>, entries: MemoryEntry[]) {
        for (const entry of entries) this.handlers?.handleDispose(entry.id);
      }
    }
    let finish!: () => void;
    const ready = new Promise<void>(resolve => { finish = resolve; });
    const app = createNestedApp(4, new ImmediateDisposeEngine('/nested/alpha'), ready);
    await app.ready;
    const outerNode = app.frame.firstChild;
    const navigation = app.router.navigate(app.routes.beta.locate({}), { replace: true });
    await navigation.committed;
    expect(app.cleanups).toEqual({ outer: 0, layout: 0, alpha: 0, beta: 0, outside: 0 });
    expect(app.frame.querySelector('[data-page="alpha"]')).not.toBeNull();
    finish();
    await navigation.finished;
    expect(app.frame.firstChild).toBe(outerNode);
    expect(app.frame.querySelector('[data-page="beta"]')).not.toBeNull();
    expect(app.cleanups).toEqual({ outer: 0, layout: 0, alpha: 1, beta: 0, outside: 0 });
    await app.router.navigate(app.routes.outside.locate({}), { replace: true }).finished;
    expect(app.cleanups).toEqual({ outer: 1, layout: 1, alpha: 1, beta: 1, outside: 0 });
  });

  it.each([1, 10])('does not resume superseded renders under evicted or retained ancestors (budget %s)', async limit => {
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const app = createNestedApp(limit, new MemoryEngine('/nested/alpha'), gate);
    await app.ready;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const navigation = app.router.navigate(app.routes.beta.locate({}));
    // Observe rejection before superseding, so an AbortError cannot be unhandled.
    const outcome = Promise.resolve(navigation.finished).catch((error: unknown) => error);
    try {
      await vi.waitFor(() => expect(app.counters.beta).toBe(1));
      await app.router.navigate(app.routes.outside.locate({})).finished;
      const outsideNode = app.frame.firstChild;
      await vi.waitFor(() => expect(document.title).toBe('outside'));
      scrollTo.mockClear();
      finish();

      expect(await outcome).toMatchObject({ name: 'AbortError' });
      expect(app.rendered.beta).toBeUndefined();
      expect(app.frame.firstChild).toBe(outsideNode);
      expect(app.router.currentLocator()?.route).toBe(app.routes.outside);
      expect(document.title).toBe('outside');
      expect(scrollTo).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();

      // The unfinished entry must keep its own state, not the outgoing page's.
      await app.engine.back().finished;
      expect(app.router.currentLocator()?.route).toBe(app.routes.beta);
      expect(app.frame.querySelector('[data-page="beta"]')).not.toBeNull();
      expect(app.counters.beta).toBe(2);
      await app.engine.forward().finished;
      expect(app.router.currentLocator()?.route).toBe(app.routes.outside);
      expect(app.frame.querySelector('[data-page="beta"]')).toBeNull();
    } finally {
      finish();
      await outcome;
      warn.mockRestore();
      scrollTo.mockRestore();
    }
  });

  it('disposes a superseded partial stack before its leaf finishes rendering', async () => {
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const app = createNestedApp(1, new MemoryEngine('/outside'), gate);
    await app.ready;
    const navigation = app.router.navigate(app.routes.beta.locate({}));
    const outcome = Promise.resolve(navigation.finished).catch((error: unknown) => error);
    try {
      await vi.waitFor(() => expect(app.frame.querySelector('[data-page="layout"]')).not.toBeNull());
      const outerNode = app.rendered.outer!.renderOutput!.html;
      const layoutNode = app.rendered.layout!.renderOutput!.html;
      await app.router.navigate(app.routes.outside.locate({})).finished;
      expect(app.cleanups.outer).toBe(1);
      expect(app.cleanups.layout).toBe(1);
      expect(outerNode.parentNode).toBeNull();
      expect(layoutNode.parentNode).toBeNull();
      finish();
      expect(await outcome).toMatchObject({ name: 'AbortError' });
      expect(app.rendered.beta).toBeUndefined();
      expect(app.frame.textContent).toBe('outside');
      expect(app.router.currentLocator()?.route).toBe(app.routes.outside);
    } finally {
      finish();
      await outcome;
    }
  });

  it('skips a superseded lazy implementation before creating its page', async () => {
    const home = route({}), slow = route({});
    const engine = new MemoryEngine('/home');
    const router = new Router(root({ home, slow }), { engine, maxCachedPages: 1 });
    const implementation = {
      untrackedKeys: [] as const,
      async render() {
        return () => ({ html: document.createElement('section'), title: 'home' });
      },
    };
    router.implement(home, implementation);
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const load = vi.fn(async () => { await gate; return slowImplementation; });
    const slowImplementation = { ...implementation, render: vi.fn(implementation.render) };
    router.implementLazy(slow, load, { untrackedKeys: slowImplementation.untrackedKeys });
    const frame = installRootFrame();
    await vi.waitFor(() => expect(router.currentLocator()?.route).toBe(home));
    const navigation = router.navigate(slow.locate({}));
    const outcome = Promise.resolve(navigation.finished).catch((error: unknown) => error);
    try {
      await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
      await router.navigate(home.locate({})).finished;
      const homeNode = frame.firstChild;
      finish();
      expect(await outcome).toMatchObject({ name: 'AbortError' });
      expect(slowImplementation.render).not.toHaveBeenCalled();
      expect(frame.firstChild).toBe(homeNode);
      expect(router.currentLocator()?.route).toBe(home);
    } finally {
      finish();
      await outcome;
    }
  });

  it('cleans up an unfinished stack when rendering rejects', async () => {
    const error = new Error('render failed');
    let fail!: (error: Error) => void;
    const gate = new Promise<void>((_, reject) => { fail = reject; });
    const app = createNestedApp(1, new MemoryEngine('/outside'), gate);
    await app.ready;
    const navigation = app.router.navigate(app.routes.beta.locate({}));
    const outcome = Promise.resolve(navigation.finished).catch((error: unknown) => error);
    await vi.waitFor(() => expect(app.frame.querySelector('[data-page="layout"]')).not.toBeNull());
    const outerNode = app.rendered.outer!.renderOutput!.html;
    fail(error);
    expect(await outcome).toBe(error);
    expect(app.cleanups.outer).toBe(1);
    expect(app.cleanups.layout).toBe(1);
    expect(outerNode.parentNode).toBeNull();
    expect(app.router.currentLocator()?.route).toBe(app.routes.outside);
    await app.router.navigate(app.routes.outside.locate({})).finished;
    expect(app.frame.textContent).toBe('outside');
  });

  it('handles disposal of a pruned nested entry without disposing shared ancestors', async () => {
    const app = createNestedApp(10);
    await app.ready;
    await app.router.navigate(app.routes.beta.locate({})).finished;
    await app.engine.back().finished;
    await app.router.navigate(app.routes.outside.locate({})).finished;
    expect(app.cleanups).toEqual({ outer: 0, layout: 0, alpha: 0, beta: 1, outside: 0 });
    await app.engine.back().finished;
    expect(app.counters).toEqual({ outer: 1, layout: 1, alpha: 1, beta: 1, outside: 1 });
  });
});
