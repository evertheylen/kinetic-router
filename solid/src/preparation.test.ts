import { afterEach, expect, it, vi } from 'vitest';
import { param, root, route, type Locator, type Route } from '@kinetic-router/definition';
import { createEffect, createOwner, flush, onCleanup, runWithOwner, useContext } from 'solid-js';
import { ActualRouter } from './actual-router.js';
import { Router } from './router.js';
import { SolidImplementationMap } from './implementation-map.js';
import { MemoryEngine } from './memory-engine.js';
import { frameDelegateAttribute, rootFrameId } from './frame.js';
import { InRenderedRoute, type RenderedRoute } from './rendered-route.js';
import { PreparationRegistry, type PrefetchCacheOptions } from './preparation-registry.js';
import { RenderedRouteCache } from './rendered-route-cache.js';
import type { Page, PagePreparationContext } from './page.js';

const routers: ActualRouter<{}, {}>[] = [];
afterEach(() => {
  for (const router of routers.splice(0)) router.dispose();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function app(options: {
  cache?: PrefetchCacheOptions, maxCachedPages?: number, initialUrl?: string,
  hiddenDefault?: () => { value: number } | undefined,
  betaGate?: (attempt: number) => Promise<void> | undefined, loadBeta?: (implementation: Page<{}, any, any>) => Promise<Page<{}, any, any>>,
} = {}) {
  const id = param.path<string>();
  const hidden = param.hidden<{ value: number } | undefined>().withDefault(options.hiddenDefault ?? (() => undefined));
  const layout = route({ id, hidden });
  const alpha = layout.nestedRoute({}), beta = layout.nestedRoute({});
  const outside = route({});
  const sitemap = root({ users: { [id.$]: { alpha, beta } }, outside });
  const impls = new SolidImplementationMap<{}, {}>(sitemap);
  const engine = new MemoryEngine(options.initialUrl ?? '/users/alice/alpha');
  const router = new ActualRouter(sitemap, impls, engine,
    new RenderedRouteCache(options.maxCachedPages), new PreparationRegistry(options.cache));
  routers.push(router);
  const output: Record<string, RenderedRoute[]> = { layout: [], alpha: [], beta: [], outside: [] };
  const contexts: Record<string, PagePreparationContext[]> = { layout: [], alpha: [], beta: [], outside: [] };
  const cleanups = { layout: 0, alpha: 0, beta: 0, outside: 0 };
  for (const name of ['layout', 'alpha', 'beta', 'outside'] as const) {
    const implementation: Page<{}, any, never> = {
      untrackedKeys: [],
      async render(_params, context) {
        contexts[name].push(context);
        onCleanup(() => cleanups[name]++);
        if (name === 'beta') await options.betaGate?.(contexts.beta.length);
        return params => {
          const rendered = useContext(InRenderedRoute)!;
          output[name].push(rendered);
          const html = document.createElement('section');
          html.dataset.page = name;
          const label = document.createElement('span');
          html.append(label);
          createEffect(() => name === 'outside' ? name : `${name} ${params.id}`, text => { label.textContent = text; });
          if (name === 'layout') {
            const outlet = document.createElement('div');
            html.append(outlet);
            rendered.subFrame = { setElement: node => outlet.replaceChildren(node), clear: () => outlet.replaceChildren() };
          } else html.append(document.createElement('input'));
          return { html, get title() { return name === 'outside' ? name : `${name} ${params.id}`; } };
        };
      },
    };
    if (name === 'beta' && options.loadBeta) {
      impls.implementLazy(beta, () => options.loadBeta!(implementation), { untrackedKeys: implementation.untrackedKeys });
    } else impls.implement({ layout, alpha, beta, outside }[name] as Route<any>, implementation);
  }
  const frame = document.createElement('main');
  frame.id = rootFrameId;
  Object.assign(frame, { [frameDelegateAttribute]: {
    setElement: (node: Node) => frame.replaceChildren(node), clear: () => frame.replaceChildren(),
  } });
  document.body.replaceChildren(frame);
  await router.init();
  flush();
  const prepare = (locator = beta.locate({ id: 'bob' })) =>
    router.acquirePreparation(router.resolveDestination(locator))!;
  return { router, engine, output, contexts, cleanups, frame, prepare, routes: { layout, alpha, beta, outside } };
}

it('defaults to three unused preparations for thirty seconds', () => {
  const registry = new PreparationRegistry();
  expect(registry.maxEntries).toBe(3);
  expect(registry.retainFor).toBe(30_000);
});

it('keeps factory defaults stable from a destination snapshot through preparation and activation', async () => {
  let value = 0;
  const a = await app({ hiddenDefault: () => ({ value: ++value }) });
  expect(value).toBe(1);
  const snapshot = a.router.resolveDestination({ route: a.routes.beta, values: { id: 'bob' } });
  expect(snapshot.locator.values.hidden).toEqual({ value: 2 });
  const lease = a.router.acquirePreparation(snapshot)!;
  const prepared = await lease.ready;
  expect((prepared.routes[1].renderArgs.params.reactiveProxyObject as { hidden: { value: number } }).hidden).toEqual({ value: 2 });
  await a.router.activateDestination(snapshot).finished;
  lease.release();
  expect(a.router.currentLocator()?.values.hidden).toEqual({ value: 2 });
  expect(value).toBe(2);
});

it('shares equivalent hidden values, stages only the new suffix, and leaves all live state untouched', async () => {
  const a = await app();
  const activeLayout = a.output.layout[0];
  const activeNode = a.frame.firstChild;
  const input = a.frame.querySelector('input')!;
  input.focus();
  const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  const history = a.engine.entries();
  const first = a.prepare(a.routes.beta.locate({ id: 'bob', hidden: { value: 1 } }));
  const second = a.prepare(a.routes.beta.locate({ id: 'bob', hidden: { value: 1 } }));
  expect(first.ready).toBe(second.ready);
  const prepared = await first.ready;
  flush();
  expect(a.contexts.beta).toHaveLength(1);
  expect(prepared.routes[0]).toBe(activeLayout);
  const child = prepared.routes[1];
  const backstage = document.querySelector('[data-kinetic-router-backstage]')!;
  expect(backstage.contains(child.renderOutput!.html)).toBe(true);
  expect(backstage.contains(activeNode)).toBe(false);
  expect(backstage.getAttribute('aria-hidden')).toBe('true');
  expect((backstage as HTMLElement).inert).toBe(true);
  expect((child.renderArgs.params.reactiveProxyObject as { id: string }).id).toBe('bob');
  expect((activeLayout.renderArgs.params.reactiveProxyObject as { id: string }).id).toBe('alice');
  expect(a.frame.firstChild).toBe(activeNode);
  expect(a.frame.textContent).toBe('layout alicealpha alice');
  expect(document.activeElement).toBe(input);
  expect(document.title).toBe('alpha alice');
  expect(scroll).not.toHaveBeenCalled();
  expect(a.engine.entries().map(e => [e.id, e.url, e.state])).toEqual(history.map(e => [e.id, e.url, e.state]));
  expect(a.router.currentLocator()?.values.id).toBe('alice');
  expect(a.router.rrCache.cache.size).toBe(1);
  first.release();
  expect(child.renderArgs.pageStatus.shouldFetch()).toBe(true);
  second.release();
  flush();
  expect(child.renderArgs.pageStatus.shouldFetch()).toBe(false);
  expect(a.cleanups.beta).toBe(0);
});

it('does not merge equal hrefs with distinct hidden parameters or interfere with other staging trees', async () => {
  const a = await app({ initialUrl: '/outside' });
  const first = a.prepare(a.routes.beta.locate({ id: 'bob', hidden: { value: 1 } }));
  const second = a.prepare(a.routes.beta.locate({ id: 'bob', hidden: { value: 2 } }));
  const [one, two] = await Promise.all([first.ready, second.ready]);
  expect(one.routes[0]).not.toBe(two.routes[0]);
  expect(one.routes[1]).not.toBe(two.routes[1]);
  const hosts = [...document.querySelectorAll('[data-kinetic-router-backstage]')];
  expect(hosts).toHaveLength(2);
  expect(hosts[0].contains(one.routes[1].renderOutput!.html)).toBe(true);
  expect(hosts[0].contains(two.routes[1].renderOutput!.html)).toBe(false);
  first.discard();
  expect(a.cleanups.layout).toBe(1);
  expect(two.signal.aborted).toBe(false);
  expect(hosts[1].isConnected).toBe(true);
});

it('release and router teardown dispose unfinished owners exactly once', async () => {
  const gate = Promise.withResolvers<void>();
  const a = await app({ betaGate: () => gate.promise });
  const lease = a.prepare();
  await vi.waitFor(() => expect(a.contexts.beta).toHaveLength(1));
  lease.release();
  lease.release();
  a.router.disposePreparations();
  expect(a.contexts.beta[0].signal.aborted).toBe(true);
  expect(a.cleanups.beta).toBe(1);
  gate.resolve();
  await expect(lease.ready).rejects.toMatchObject({ name: 'AbortError' });
  expect(a.cleanups.beta).toBe(1);
});

it('takes navigation ownership before speculative release and adopts under the actual committed id', async () => {
  const gate = Promise.withResolvers<void>();
  const a = await app({ betaGate: () => gate.promise, cache: { maxEntries: 0 } });
  const locator = a.routes.beta.locate({ id: 'bob' });
  const lease = a.prepare(locator);
  await vi.waitFor(() => expect(a.contexts.beta).toHaveLength(1));
  const parent = a.output.layout[0];
  const navigation = a.router.navigate(locator, { mode: 'replace' });
  lease.release();
  expect(a.contexts.beta[0].signal.aborted).toBe(false);
  gate.resolve();
  const prepared = await lease.ready;
  await navigation.finished;
  flush();
  expect(a.output.beta).toHaveLength(1);
  expect(a.frame.firstChild).toBe(parent.renderOutput!.html);
  expect(a.frame.querySelector('[data-page="beta"]')).toBe(prepared.routes[1].renderOutput!.html);
  expect(a.router.rrCache.get(a.engine.currentEntry().id)?.[1]).toBe(prepared.routes[1]);
  expect(a.engine.entries()).toHaveLength(1);
  expect(a.frame.textContent).toBe('layout bobbeta bob');
  expect(document.title).toBe('beta bob');
  expect(prepared.routes[1].renderArgs.pageStatus.hasFocus()).toBe(true);
  expect(document.querySelector('[data-kinetic-router-backstage]')).toBeNull();
  a.router.disposePreparations();
  lease.release();
  expect(a.cleanups.beta).toBe(0);
  expect(a.contexts.beta[0].signal.aborted).toBe(false);
});

it.each([0, 10])('preserves all consumer interests across adoption and history eviction (budget %s)', async maxCachedPages => {
  const a = await app({ maxCachedPages });
  const target = a.routes.beta.locate({ id: 'bob' });
  const first = a.prepare(target), second = a.prepare(target);
  const prepared = await first.ready;
  const status = prepared.routes[1].renderArgs.pageStatus;
  const fetching = status.fetchSignal()!;
  await a.router.navigate(target).finished;
  const entry = a.engine.currentEntry();
  await a.router.navigate(a.routes.outside.locate({})).finished;
  flush();
  expect(status.isVisible()).toBe(false);
  expect(status.shouldFetch()).toBe(true);
  expect(status.fetchSignal()).toBe(fetching);
  expect(fetching.aborted).toBe(false);
  expect(a.cleanups.beta).toBe(0);
  first.release();
  expect(fetching.aborted).toBe(false);

  // An adopted preparation cannot become a speculative cache hit for a new entry.
  const next = a.prepare(target);
  expect(next.ready).not.toBe(first.ready);
  const fresh = await next.ready;
  expect(fresh.routes[1]).not.toBe(prepared.routes[1]);
  second.release();
  flush();
  expect(fetching.aborted).toBe(true);
  expect(a.cleanups.beta).toBe(maxCachedPages === 0 ? 1 : 0);
  if (maxCachedPages > 0) {
    expect(a.router.rrCache.get(entry.id)?.[1]).toBe(prepared.routes[1]);
    const resume = a.router.acquirePreparation(a.router.resolveDestination(target, 'menu'))!;
    await resume.ready;
    const renewed = status.fetchSignal()!;
    expect(renewed).not.toBe(fetching);
    expect(renewed.aborted).toBe(false);
    resume.release();
    expect(renewed.aborted).toBe(true);
  }
  next.release();
});

it('router teardown releases adopted consumer pins without disposing the active page', async () => {
  const a = await app({ maxCachedPages: 0 });
  const lease = a.prepare();
  const prepared = await lease.ready;
  const fetching = prepared.routes[1].renderArgs.pageStatus.fetchSignal()!;
  await a.router.navigate(a.routes.beta.locate({ id: 'bob' })).finished;
  await a.router.navigate(a.routes.outside.locate({})).finished;
  expect(fetching.aborted).toBe(false);
  a.router.disposePreparations();
  lease.release();
  expect(fetching.aborted).toBe(true);
  expect(a.cleanups.beta).toBe(1);
  expect(a.contexts.outside[0].pageStatus.isVisible()).toBe(true);
});

it('adopts under the same parent after intervening reactive parameter changes without leaking them into prepared children', async () => {
  const a = await app();
  const lease = a.prepare();
  const prepared = await lease.ready;
  const parent = prepared.routes[0], child = prepared.routes[1];
  await a.router.navigate(a.routes.alpha.locate({ id: 'carol' })).finished;
  flush();
  expect((child.renderArgs.params.reactiveProxyObject as { id: string }).id).toBe('bob');
  await a.router.navigate(a.routes.beta.locate({ id: 'bob' })).finished;
  flush();
  expect(a.frame.firstChild).toBe(parent.renderOutput!.html);
  expect(a.output.beta).toHaveLength(1);
  expect(a.frame.querySelector('[data-page="beta"]')).toBe(child.renderOutput!.html);
  await a.router.navigate(a.routes.beta.locate({ id: 'dan' })).finished;
  flush();
  expect(a.frame.textContent).toBe('layout danbeta dan');
  expect(a.output.beta).toHaveLength(1);
});

it('preserves compatible prepared output when an unfinished navigation is superseded', async () => {
  const gate = Promise.withResolvers<void>();
  const a = await app({ betaGate: attempt => attempt === 2 ? gate.promise : undefined });
  const target = a.routes.beta.locate({ id: 'bob' });
  const lease = a.prepare(target);
  const prepared = await lease.ready;
  const activeNode = a.frame.firstChild;
  const interrupted = a.router.navigate(target, { forceNewInstance: true });
  try {
    await vi.waitFor(() => expect(a.contexts.beta).toHaveLength(2));
    const navigation = a.router.navigate(target);
    lease.release();
    await navigation.finished;
    expect(a.frame.firstChild).toBe(activeNode);
    expect(a.frame.querySelector('[data-page="beta"]')).toBe(prepared.routes[1].renderOutput!.html);
    expect(a.output.layout).toHaveLength(1);
    expect(a.output.beta).toHaveLength(1);
  } finally {
    gate.resolve();
    await expect(interrupted.finished).rejects.toMatchObject({ name: 'AbortError' });
  }
});

it('cancels navigation-owned construction promptly when no speculative owner remains', async () => {
  const gate = Promise.withResolvers<void>();
  const a = await app({ betaGate: () => gate.promise });
  const lease = a.prepare();
  await vi.waitFor(() => expect(a.contexts.beta).toHaveLength(1));
  const navigation = a.router.navigate(a.routes.beta.locate({ id: 'bob' }));
  lease.release();
  await a.router.navigate(a.routes.outside.locate({})).finished;
  expect(a.contexts.beta[0].signal.aborted).toBe(true);
  expect(a.cleanups.beta).toBe(1);
  gate.resolve();
  await expect(navigation.finished).rejects.toMatchObject({ name: 'AbortError' });
  expect(a.output.beta).toHaveLength(0);
  expect(a.frame.textContent).toBe('outside');
});

it('does not cancel a still-requested preparation when its navigation is superseded', async () => {
  const gate = Promise.withResolvers<void>();
  const a = await app({ betaGate: () => gate.promise });
  const lease = a.prepare();
  await vi.waitFor(() => expect(a.contexts.beta).toHaveLength(1));
  const navigation = a.router.navigate(a.routes.beta.locate({ id: 'bob' }));
  await a.router.navigate(a.routes.outside.locate({})).finished;
  expect(a.contexts.beta[0].signal.aborted).toBe(false);
  gate.resolve();
  const prepared = await lease.ready;
  await expect(navigation.finished).rejects.toMatchObject({ name: 'AbortError' });
  flush();
  expect(a.frame.textContent).toBe('outside');
  expect(prepared.routes[1].renderArgs.pageStatus.isVisible()).toBe(false);
  expect(document.title).toBe('outside');
  lease.release();
  flush();
  expect(prepared.routes[1].renderArgs.pageStatus.shouldFetch()).toBe(false);
});

it.each(['lazy', 'renderer'] as const)('handles %s failure, shares implementation loading, and retries after failure', async phase => {
  const gate = Promise.withResolvers<void>();
  const load = vi.fn(async (implementation: Page<{}, any, any>) => {
    if (phase === 'lazy' && load.mock.calls.length === 1) await gate.promise;
    return implementation;
  });
  const a = await app({ loadBeta: load, betaGate: phase === 'renderer' ? attempt => attempt <= 2 ? gate.promise : undefined : undefined });
  const first = a.prepare(a.routes.beta.locate({ id: 'bob', hidden: { value: 1 } }));
  const second = a.prepare(a.routes.beta.locate({ id: 'bob', hidden: { value: 2 } }));
  await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
  if (phase === 'renderer') await vi.waitFor(() => expect(a.contexts.beta).toHaveLength(2));
  const error = new Error('preparation failed');
  gate.reject(error);
  await expect(first.ready).rejects.toBe(error);
  await expect(second.ready).rejects.toBe(error);
  flush();
  expect(a.frame.textContent).toBe('layout alicealpha alice');
  expect(document.title).toBe('alpha alice');
  if (phase === 'renderer') expect(a.cleanups.beta).toBe(2);
  // Failed work is removed, not cached as a permanently rejected preparation.
  await a.router.navigate(a.routes.beta.locate({ id: 'bob' })).finished;
  expect(load).toHaveBeenCalledTimes(phase === 'lazy' ? 2 : 1);
  expect(a.output.beta).toHaveLength(1);
});

it('shares an uncancellable import across cancellation and retry without constructing stale output', async () => {
  const gate = Promise.withResolvers<void>();
  const load = vi.fn(async (implementation: Page<{}, any, any>) => { await gate.promise; return implementation; });
  const a = await app({ loadBeta: load });
  const first = a.prepare();
  await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
  first.release();
  const retry = a.prepare();
  gate.resolve();
  await expect(first.ready).rejects.toMatchObject({ name: 'AbortError' });
  await retry.ready;
  expect(load).toHaveBeenCalledOnce();
  expect(a.contexts.beta).toHaveLength(1);
  expect(a.output.beta).toHaveLength(1);
});

it('can acquire navigation ownership reentrantly while retention aborts a fetch-active period', async () => {
  const a = await app();
  const lease = a.prepare();
  const prepared = await lease.ready;
  const status = prepared.routes[1].renderArgs.pageStatus;
  const fetching = status.fetchSignal()!;
  let navigation: ReturnType<typeof a.router.navigate> | undefined;
  fetching.addEventListener('abort', () => {
    navigation = a.router.navigate(a.routes.beta.locate({ id: 'bob' }));
  }, { once: true });
  lease.release();
  expect(navigation).toBeDefined();
  await navigation!.finished;
  flush();
  expect(status.isVisible()).toBe(true);
  expect(status.fetchSignal()).not.toBe(fetching);
  expect(status.fetchSignal()?.aborted).toBe(false);
  expect(a.output.beta).toHaveLength(1);
  expect(a.cleanups.beta).toBe(0);
});

it('retains completed output, stops fetching, renews the signal on reacquire, and expires from last release', async () => {
  const a = await app({ cache: { retainFor: 100, maxEntries: 2 } });
  const first = a.prepare();
  const prepared = await first.ready;
  const status = prepared.routes[1].renderArgs.pageStatus;
  const initial = status.fetchSignal()!;
  vi.useFakeTimers();
  first.release();
  flush();
  expect(initial.aborted).toBe(true);
  expect(status.fetchSignal()).toBeUndefined();
  expect(status.isVisible()).toBe(false);
  await vi.advanceTimersByTimeAsync(90);
  const second = a.prepare();
  flush();
  expect(second.ready).toBe(first.ready);
  expect(status.fetchSignal()?.aborted).toBe(false);
  expect(status.fetchSignal()).not.toBe(initial);
  await vi.advanceTimersByTimeAsync(100);
  expect(a.cleanups.beta).toBe(0);
  second.release();
  await vi.advanceTimersByTimeAsync(99);
  expect(a.cleanups.beta).toBe(0);
  await vi.advanceTimersByTimeAsync(1);
  expect(a.cleanups.beta).toBe(1);
  expect(a.output.layout[0].renderArgs.pageStatus.isVisible()).toBe(true);
});

it('evicts unused preparations in LRU order without evicting history-owned pages', async () => {
  const a = await app({ cache: { maxEntries: 2 }, maxCachedPages: 0 });
  const target = (id: string) => a.routes.beta.locate({ id });
  const first = a.prepare(target('one')), second = a.prepare(target('two'));
  const [one, two] = await Promise.all([first.ready, second.ready]);
  first.release(); second.release();
  const refreshed = a.prepare(target('one'));
  refreshed.release();
  const third = a.prepare(target('three'));
  await third.ready;
  third.release();
  expect(one.signal.aborted).toBe(false);
  expect(two.signal.aborted).toBe(true);
  expect(a.cleanups.beta).toBe(1);
  expect(a.router.rrCache.cache.size).toBe(1);
  expect(a.output.alpha[0].renderArgs.pageStatus.isVisible()).toBe(true);
  await a.router.navigate(target('one')).finished;
  refreshed.release();
  a.router.disposePreparations();
  expect(one.routes[1].renderArgs.pageStatus.isVisible()).toBe(true);
  expect(a.cleanups.beta).toBe(2); // two + three, never adopted one
});

it.each([{ maxEntries: 0 }, { retainFor: 0 }])('zero disables unused retention: %j', async cache => {
  const a = await app({ cache });
  const lease = a.prepare();
  const prepared = await lease.ready;
  lease.release();
  expect(prepared.signal.aborted).toBe(true);
  expect(a.cleanups.beta).toBe(1);
  const retry = a.prepare();
  expect(retry.ready).not.toBe(lease.ready);
  await retry.ready;
  expect(a.output.beta).toHaveLength(2);
});

it.each(['different-parent', 'new-active-parent'] as const)('rejects incompatible %s context without replacing reusable active layouts', async scenario => {
  const a = await app({ maxCachedPages: 0, initialUrl: scenario === 'new-active-parent' ? '/outside' : undefined });
  const lease = a.prepare();
  const prepared = await lease.ready;
  if (scenario === 'different-parent') await a.router.navigate(a.routes.outside.locate({})).finished;
  await a.router.navigate(a.routes.alpha.locate({ id: 'carol' })).finished;
  const activeParent = a.output.layout.at(-1)!;
  const activeNode = a.frame.firstChild;
  await a.router.navigate(a.routes.beta.locate({ id: 'bob' })).finished;
  flush();
  expect(a.frame.firstChild).toBe(activeNode);
  expect(a.output.layout.at(-1)).toBe(activeParent);
  expect(a.output.beta).toHaveLength(2);
  expect(prepared.signal.aborted).toBe(true);
  expect(a.output.beta[1].renderArgs.params.parent).toBe(activeParent.renderArgs.params);
  expect(a.frame.textContent).toBe('layout bobbeta bob');
  lease.release();
  expect(a.output.beta[1].renderArgs.pageStatus.isVisible()).toBe(true);
});

it('isolates equal history destinations by entry id and restores the correct prepared instance', async () => {
  const a = await app({ maxCachedPages: 0 });
  const target = a.routes.beta.locate({ id: 'bob' });
  await a.router.navigate(target).finished;
  const firstEntry = a.engine.currentEntry();
  await a.router.navigate(target, { forceNewInstance: true }).finished;
  const secondEntry = a.engine.currentEntry();
  await a.router.navigate(a.routes.outside.locate({})).finished;
  const outside = a.engine.currentEntry();
  const prepareHistory = () => a.router.acquirePreparation(a.router.resolveDestination(target, 'menu'))!;
  await a.engine.traverseTo(firstEntry.key).finished;
  await a.engine.traverseTo(outside.key).finished;
  const first = prepareHistory();
  const one = await first.ready;
  await a.engine.traverseTo(secondEntry.key).finished;
  await a.engine.traverseTo(outside.key).finished;
  const second = prepareHistory();
  const two = await second.ready;
  expect(one.routes[1]).not.toBe(two.routes[1]);
  expect(first.ready).not.toBe(second.ready);
  await a.engine.traverseTo(firstEntry.key).finished;
  expect(a.router.rrCache.get(firstEntry.id)?.[1]).toBe(one.routes[1]);
  expect(two.routes[1].renderArgs.pageStatus.isVisible()).toBe(false);
  first.release(); second.release();
  expect(one.routes[1].renderArgs.pageStatus.isVisible()).toBe(true);
  expect(a.engine.entries()).toHaveLength(4);
});

it('does not allow abort callbacks or later requests to resurrect a disposed registry', async () => {
  const a = await app();
  const target = a.router.resolveDestination(a.routes.beta.locate({ id: 'bob' }));
  const lease = a.router.acquirePreparation(target)!;
  const prepared = await lease.ready;
  const reacquire = vi.fn(() => a.router.acquirePreparation(target));
  prepared.routes[1].renderArgs.pageStatus.fetchSignal()!.addEventListener('abort', reacquire, { once: true });
  a.router.disposePreparations();
  expect(reacquire).toHaveBeenCalledOnce();
  expect(reacquire.mock.results[0].value).toBeUndefined();
  expect(a.router.acquirePreparation(target)).toBeUndefined();
  expect(a.cleanups.beta).toBe(1);
  expect(document.querySelector('[data-kinetic-router-backstage]')).toBeNull();
});

it('releases speculation immediately when the facade owning Solid root is disposed', async () => {
  class TestFacade extends Router {
    prepare(locator: Locator<any>) {
      return this.actualRouter!.acquirePreparation(this.resolveDestination(locator))!;
    }
  }
  const home = route({}), slow = route({});
  const owner = createOwner();
  const router = runWithOwner(owner, () => new TestFacade(root({ home, slow }), { engine: new MemoryEngine('/home') }));
  const gate = Promise.withResolvers<void>();
  let context: PagePreparationContext | undefined;
  const cleanup = vi.fn();
  router.implement(home, { untrackedKeys: [], async render() { return () => ({ html: document.createElement('div'), title: 'home' }); } });
  router.implement(slow, {
    untrackedKeys: [],
    async render(_params, preparationContext) {
      context = preparationContext;
      onCleanup(cleanup);
      await gate.promise;
      return () => ({ html: document.createElement('div'), title: 'slow' });
    },
  });
  const frame = document.createElement('div');
  frame.id = rootFrameId;
  Object.assign(frame, { [frameDelegateAttribute]: { setElement: (node: Node) => frame.replaceChildren(node), clear: () => frame.replaceChildren() } });
  document.body.replaceChildren(frame);
  await vi.waitFor(() => expect(router.currentLocator()).toBeDefined());
  const lease = router.prepare(slow.locate({}));
  await vi.waitFor(() => expect(context).toBeDefined());
  lease.release();
  owner.dispose();
  expect(context!.signal.aborted).toBe(true);
  expect(cleanup).toHaveBeenCalledOnce();
  gate.resolve();
  await expect(lease.ready).rejects.toMatchObject({ name: 'AbortError' });
  expect(document.querySelector('[data-kinetic-router-backstage]')).toBeNull();
});

it('keeps requested ancestors fetch-active after an intervening navigation hides them', async () => {
  const a = await app();
  const lease = a.prepare();
  const prepared = await lease.ready;
  const parent = prepared.routes[0].renderArgs.pageStatus;
  const fetching = parent.fetchSignal()!;
  await a.router.navigate(a.routes.outside.locate({})).finished;
  flush();
  expect(parent.isVisible()).toBe(false);
  expect(parent.shouldFetch()).toBe(true);
  expect(fetching.aborted).toBe(false);
  lease.release();
  flush();
  expect(parent.shouldFetch()).toBe(false);
  expect(fetching.aborted).toBe(true);
});

it('resumes fetching for history-cached preparations without losing shared or navigation ownership', async () => {
  const a = await app();
  const target = a.routes.beta.locate({ id: 'bob' });
  await a.router.navigate(target).finished;
  const child = a.output.beta[0];
  const status = child.renderArgs.pageStatus;
  await a.router.navigate(a.routes.outside.locate({})).finished;
  flush();
  expect(status.shouldFetch()).toBe(false);
  const snapshot = a.router.resolveDestination(target, 'menu');
  const first = a.router.acquirePreparation(snapshot)!;
  const second = a.router.acquirePreparation(snapshot)!;
  const prepared = await first.ready;
  flush();
  const fetching = status.fetchSignal()!;
  expect(prepared.routes[1]).toBe(child);
  expect(fetching.aborted).toBe(false);
  expect(status.isVisible()).toBe(false);
  first.release();
  expect(fetching.aborted).toBe(false);
  second.release();
  expect(fetching.aborted).toBe(true);
  const retry = a.router.acquirePreparation(snapshot)!;
  await retry.ready;
  const resumed = status.fetchSignal()!;
  expect(resumed).not.toBe(fetching);
  await a.router.activateDestination(snapshot).finished;
  retry.release();
  flush();
  expect(status.isVisible()).toBe(true);
  expect(status.fetchSignal()).toBe(resumed);
  expect(resumed.aborted).toBe(false);
});

it('skips no-op destinations and revalidates menu resolution before acquiring', async () => {
  const a = await app();
  expect(a.router.acquirePreparation(a.router.resolveDestination(a.routes.alpha.locate({ id: 'alice' }), 'menu'))).toBeUndefined();
  const stale = a.router.resolveDestination(a.routes.beta.locate({ id: 'bob' }), 'menu');
  await a.router.navigate(a.routes.beta.locate({ id: 'bob' })).finished;
  expect(a.router.acquirePreparation(stale)).toBeUndefined();
});
