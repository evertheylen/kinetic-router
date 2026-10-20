import { expect, it, vi } from 'vitest';
import { param, root, route, type Locator } from '@kinetic-router/definition';
import { createEffect, flush, onCleanup, useContext } from 'solid-js';
import { ActualRouter, type PreparedNavigation } from './actual-router.js';
import { AppState } from './app-state.js';
import { frameDelegateAttribute, rootFrameId } from './frame.js';
import { SolidImplementationMap } from './implementation-map.js';
import { MemoryEngine } from './memory-engine.js';
import { InRenderedRoute, type RenderedRoute } from './rendered-route.js';
import type { PagePreparationContext } from './page.js';

class TestRouter extends ActualRouter<{}, {}> {
  prepare(locator: Locator<any>, reused: readonly RenderedRoute[], signal: AbortSignal) {
    return this.prepareNavigation(AppState.fromLocator(locator), reused, signal);
  }

  activate(locator: Locator<any>, prepared: PreparedNavigation, signal: AbortSignal) {
    this.activateNavigation(AppState.fromLocator(locator), prepared, signal);
  }
}

it('cancels sibling construction on failure even when the caller has not aborted its request', async () => {
  const parent = route({}), child = parent.nestedRoute({});
  const sitemap = root({ child });
  const implementations = new SolidImplementationMap<{}, {}>(sitemap);
  const router = new TestRouter(sitemap, implementations, new MemoryEngine('/child'));
  const parentReady = Promise.withResolvers<void>(), childReady = Promise.withResolvers<void>();
  const parentCleanup = vi.fn(), childCleanup = vi.fn();
  const childOutput = vi.fn(() => ({ html: document.createElement('div'), title: 'stale' }));
  let childContext: PagePreparationContext | undefined;
  implementations.implement(parent, {
    untrackedKeys: [],
    async render() {
      onCleanup(parentCleanup);
      await parentReady.promise;
      return childOutput;
    },
  });
  implementations.implement(child, {
    untrackedKeys: [],
    async render(_params, context) {
      childContext = context;
      onCleanup(childCleanup);
      await childReady.promise;
      return childOutput;
    },
  });
  const controller = new AbortController();
  const outcome = router.prepare(child.locate({}), [], controller.signal).catch((error: unknown) => error);
  await vi.waitFor(() => expect(childContext).toBeDefined());
  const fetchSignal = childContext!.pageStatus.fetchSignal()!;
  const failure = new Error('ancestor factory failed');
  parentReady.reject(failure);
  expect(await outcome).toBe(failure);
  expect(controller.signal.aborted).toBe(false);
  expect(childContext!.signal.aborted).toBe(true);
  expect(fetchSignal.aborted).toBe(true);
  expect(parentCleanup).toHaveBeenCalledOnce();
  expect(childCleanup).toHaveBeenCalledOnce();
  childReady.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(childOutput).not.toHaveBeenCalled();
  controller.abort();
  expect(parentCleanup).toHaveBeenCalledOnce();
  expect(childCleanup).toHaveBeenCalledOnce();
});

function installRootFrame() {
  const frame = document.createElement('div');
  frame.id = rootFrameId;
  Object.assign(frame, { [frameDelegateAttribute]: {
    setElement: (node: Node) => frame.replaceChildren(node), clear: () => frame.replaceChildren(),
  } });
  document.body.replaceChildren(frame);
  return frame;
}

async function createApp(betaReady?: Promise<void>) {
  const id = param.path<string>();
  const layout = route({ id });
  const alpha = layout.nestedRoute({}), beta = layout.nestedRoute({});
  const sitemap = root({ users: { [id.$]: { alpha, beta } } });
  const implMap = new SolidImplementationMap<{}, {}>(sitemap);
  const engine = new MemoryEngine('/users/alice/alpha');
  const router = new TestRouter(sitemap, implMap, engine);
  const rendered: Partial<Record<'layout' | 'alpha' | 'beta', RenderedRoute>> = {};
  const initialParams: Partial<Record<'layout' | 'alpha' | 'beta', string>> = {};
  const cleanups = { layout: 0, alpha: 0, beta: 0 };
  for (const name of ['layout', 'alpha', 'beta'] as const) {
    implMap.implement({ layout, alpha, beta }[name], {
      untrackedKeys: [],
      async render() {
        if (name === 'beta') await betaReady;
        return params => {
          const current = useContext(InRenderedRoute)!;
          rendered[name] = current;
          initialParams[name] = params.id;
          onCleanup(() => cleanups[name]++);
          const html = document.createElement('section');
          const text = document.createElement('span');
          html.append(text);
          createEffect(() => params.id, id => { text.textContent = `${name} ${id}`; });
          if (name === 'layout') {
            const outlet = document.createElement('div');
            html.append(outlet);
            current.subFrame = { setElement: node => outlet.replaceChildren(node), clear: () => outlet.replaceChildren() };
          } else {
            html.append(document.createElement('input'));
          }
          return { html, get title() { return `${name} ${params.id}`; } };
        };
      },
    });
  }
  const frame = installRootFrame();
  await router.init();
  flush();
  return { router, engine, frame, routes: { layout, alpha, beta }, rendered, initialParams, cleanups };
}

it('constructs detached destination output without changing live params, frames, focus, title, scroll or history', async () => {
  const app = await createApp();
  const activeStack = app.router.rrCache.get(app.engine.currentEntry().id)!;
  const activeNode = app.frame.firstChild;
  const input = app.frame.querySelector('input')!;
  input.focus();
  const controller = new AbortController();
  const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  try {
    const prepared = await app.router.prepare(app.routes.beta.locate({ id: 'bob' }), activeStack.slice(0, 1), controller.signal);
    flush();
    expect(prepared.reusedCount).toBe(1);
    expect(prepared.routes[0]).toBe(activeStack[0]);
    expect(app.initialParams.beta).toBe('bob');
    expect((app.rendered.layout!.renderArgs.params.reactiveProxyObject as { id: string }).id).toBe('alice');
    expect(app.frame.firstChild).toBe(activeNode);
    expect(app.frame.textContent).toBe('layout alicealpha alice');
    expect(document.activeElement).toBe(input);
    expect(document.title).toBe('alpha alice');
    expect(scroll).not.toHaveBeenCalled();
    expect(app.router.currentLocator()?.values).toEqual({ id: 'alice' });
    expect(app.engine.entries()).toHaveLength(1);
    expect(app.router.rrCache.cache.size).toBe(1);
    const beta = prepared.routes[1];
    expect(beta.renderOutput!.html.parentNode).toBeNull();
    expect(beta.renderArgs.pageStatus.shouldFetch()).toBe(true);
    expect(beta.renderArgs.pageStatus.isVisible()).toBe(false);
    expect(beta.renderArgs.pageStatus.hasFocus()).toBe(false);
    const fetching = beta.renderArgs.pageStatus.fetchSignal()!;
    prepared.dispose();
    prepared.dispose();
    controller.abort();
    flush();
    expect(fetching.aborted).toBe(true);
    expect(beta.renderArgs.pageStatus.shouldFetch()).toBe(false);
    expect(app.cleanups).toEqual({ layout: 0, alpha: 0, beta: 1 });
    expect(app.frame.firstChild).toBe(activeNode);
    expect(document.title).toBe('alpha alice');
  } finally {
    controller.abort();
    scroll.mockRestore();
  }
});

it('cannot activate disposed construction even if the caller has not aborted its request', async () => {
  const app = await createApp();
  const activeStack = app.router.rrCache.get(app.engine.currentEntry().id)!;
  const before = app.frame.innerHTML;
  const controller = new AbortController();
  const target = app.routes.beta.locate({ id: 'bob' });
  const prepared = await app.router.prepare(target, activeStack.slice(0, 1), controller.signal);
  prepared.dispose();
  expect(controller.signal.aborted).toBe(false);
  let error: unknown;
  try { app.router.activate(target, prepared, controller.signal); }
  catch (caught) { error = caught; }
  expect(error).toMatchObject({ name: 'AbortError' });
  flush();
  expect(app.frame.innerHTML).toBe(before);
  expect(app.frame.textContent).toBe('layout alicealpha alice');
  expect(app.router.currentLocator()?.route).toBe(app.routes.alpha);
  expect(app.cleanups).toEqual({ layout: 0, alpha: 0, beta: 1 });
});

it('defers live parent updates until activation, then reconnects prepared inherited params to that parent', async () => {
  const gate = Promise.withResolvers<void>();
  const app = await createApp(gate.promise);
  const parent = app.rendered.layout;
  const navigation = app.router.navigate(app.routes.beta.locate({ id: 'bob' }));
  await navigation.committed;
  expect((parent!.renderArgs.params.reactiveProxyObject as { id: string }).id).toBe('alice');
  expect(app.frame.textContent).toBe('layout alicealpha alice');
  expect(document.title).toBe('alpha alice');
  gate.resolve();
  await navigation.finished;
  flush();
  expect(app.rendered.layout).toBe(parent);
  expect(app.initialParams.beta).toBe('bob');
  expect(app.rendered.beta!.renderArgs.params.parent).toBe(parent!.renderArgs.params);
  expect(app.frame.textContent).toBe('layout bobbeta bob');
  expect(document.title).toBe('beta bob');
  const beta = app.rendered.beta;
  await app.router.navigate(app.routes.beta.locate({ id: 'carol' })).finished;
  flush();
  expect(app.rendered.beta).toBe(beta);
  expect(app.frame.textContent).toBe('layout carolbeta carol');
  expect(document.title).toBe('beta carol');
  expect(app.cleanups).toEqual({ layout: 0, alpha: 0, beta: 0 });
});

it('preserves structurally equal parameter values when reusing a page', async () => {
  const detail = route({ payload: param.hidden<{ value: number }>(), revision: param.hidden<number>() });
  const sitemap = root({ detail });
  const implementations = new SolidImplementationMap<{}, {}>(sitemap);
  const engine = new MemoryEngine('/detail');
  const original = { value: 1 };
  engine.updateCurrentEntry(AppState.fromLocator(detail.locate({ payload: original, revision: 1 })).serialize(sitemap));
  const router = new TestRouter(sitemap, implementations, engine);
  let params!: { payload: { value: number }, revision: number };
  implementations.implement(detail, {
    untrackedKeys: [],
    async render() {
      return reactive => {
        params = reactive;
        return { html: document.createElement('section'), title: 'detail' };
      };
    },
  });
  installRootFrame();
  await router.init();
  flush();
  expect(params.payload).toBe(original);
  await router.navigate(detail.locate({ payload: { value: 1 }, revision: 1 })).finished;
  flush();
  expect(params.payload).toBe(original);
  await router.navigate(detail.locate({ payload: { value: 1 }, revision: 2 })).finished;
  flush();
  expect(params.payload).toBe(original);
  expect(params.revision).toBe(2);
});

it('transfers ownership before fetch-abort callbacks can supersede activation', async () => {
  const app = await createApp();
  const fetching = app.rendered.alpha!.renderArgs.pageStatus.fetchSignal()!;
  let latest: ReturnType<typeof app.router.navigate> | undefined;
  fetching.addEventListener('abort', () => {
    latest = app.router.navigate(app.routes.beta.locate({ id: 'carol' }));
  }, { once: true });
  const interrupted = app.router.navigate(app.routes.beta.locate({ id: 'bob' }));
  await expect(interrupted.finished).rejects.toMatchObject({ name: 'AbortError' });
  expect(latest).toBeDefined();
  await latest!.finished;
  flush();
  const beta = app.rendered.beta;
  expect(app.initialParams.beta).toBe('bob');
  expect(app.cleanups).toEqual({ layout: 0, alpha: 0, beta: 0 });
  expect(app.frame.textContent).toBe('layout carolbeta carol');
  expect(app.router.currentLocator()?.values).toEqual({ id: 'carol' });
  expect(document.title).toBe('beta carol');
  await app.engine.back().finished;
  flush();
  expect(app.rendered.beta).toBe(beta);
  expect(app.frame.textContent).toBe('layout bobbeta bob');
  expect(document.title).toBe('beta bob');
  expect(app.cleanups).toEqual({ layout: 0, alpha: 0, beta: 0 });
});
