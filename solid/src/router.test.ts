// End-to-end tests of Router/ActualRouter running headlessly (happy-dom)
// on top of a MemoryEngine. Pages are implemented with plain DOM nodes, and
// the root Frame is replaced by a hand-made frame delegate, so no JSX or
// Solid rendering setup is needed.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { param, route, root } from '@kinetic-router/definition';

import { Router } from './router.js';
import { MemoryEngine } from './memory-engine.js';
import { FrameDelegate, frameDelegateAttribute, rootFrameId } from './frame.js';

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

function createApp(initialUrl: string) {
  const userId = param.path<string>();
  const home = route({});
  const user = route({ userId });

  const sitemap = root({
    home,
    users: { [userId.$]: user },
  });

  const engine = new MemoryEngine(initialUrl);
  const router = new Router(sitemap, { engine });

  const counters = { home: 0, user: 0 };
  let lastUserParams: { userId: string } | undefined;

  router.implement(home, {
    untrackedKeys: [],
    async render() {
      counters.home++;
      return () => {
        const html = document.createElement('div');
        html.textContent = 'home page';
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
    router, engine, frame, counters, ready,
    routes: { home, user },
    getUserParams: () => lastUserParams,
  };
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
