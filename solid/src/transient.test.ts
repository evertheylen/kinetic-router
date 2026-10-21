import { afterEach, expect, it, vi } from 'vitest';
import { index, param, root, route } from '@kinetic-router/definition';
import { flush, onCleanup } from 'solid-js';
import { ActualRouter } from './actual-router.js';
import { AppState } from './app-state.js';
import { outletDelegateAttribute, rootOutletId } from './outlet.js';
import { SolidImplementationMap } from './implementation-map.js';
import { MemoryEngine } from './memory-engine.js';
import type { EngineNavigationResult, NavigationInfo, NavigationIntent } from './navigation-engine.js';
import { RenderedRouteCache } from './rendered-route-cache.js';
import { Router, type TransientHandle } from './router.js';

class TestRouter extends ActualRouter<{}, {}> {
  get records() { return this.transients.size; }
  get stacksByEntry() { return this.transientStacksByEntry; }
}

// A host can delay/cancel before commit; MemoryEngine itself commits immediately.
class ControlledEngine extends MemoryEngine {
  hold = false;
  requests: { commit(): void, cancel(): void }[] = [];
  abort() { this.navigationController?.abort(); }
  forget(id: string, replace = false) {
    const current = this.currentEntry().id;
    const i = this.stack.findIndex(entry => entry.id === id);
    if (replace) this.stack[i] = { ...this.stack[i], id: id + ':replacement' };
    else this.stack.splice(i, 1);
    this.index = this.stack.findIndex(entry => entry.id === current);
    this.handlers?.handleDispose(id);
  }
  private request(run: () => EngineNavigationResult): EngineNavigationResult {
    if (!this.hold) return run();
    this.hold = false;
    const committed = Promise.withResolvers<{ id: string }>();
    const finished = Promise.withResolvers<unknown>();
    this.requests.push({
      commit() {
        const result = run();
        void result.committed?.then(committed.resolve, committed.reject);
        void result.finished?.then(finished.resolve, finished.reject);
      },
      cancel() {
        const error = new DOMException('Cancelled', 'AbortError');
        committed.reject(error); finished.reject(error);
      },
    });
    return { committed: committed.promise, finished: finished.promise };
  }
  override navigate(intent: NavigationIntent) { return this.request(() => super.navigate(intent)); }
  override traverseTo(key: string, info?: NavigationInfo) { return this.request(() => super.traverseTo(key, info)); }
}

const disposals: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposals.splice(0).reverse()) dispose();
  vi.restoreAllMocks();
});
async function app(maxPages = 10, engine = new ControlledEngine('/a')) {
  let defaults = 0;
  const token = param.hidden<number>().withDefault(() => ++defaults);
  const a = route({ token }), b = route({ token }), detail = route({ token });
  const sitemap = root({ a: { [index]: a, detail }, b });
  const impl = new SolidImplementationMap<{}, {}>(sitemap);
  const rendered = { a: 0, b: 0, detail: 0 };
  const pagesDisposed: string[] = [];
  let failB = false;
  for (const name of ['a', 'b', 'detail'] as const) impl.implement({ a, b, detail }[name], {
    untrackedKeys: [],
    async render() {
      rendered[name]++;
      if (name === 'b' && failB) throw new Error('B failed');
      onCleanup(() => pagesDisposed.push(name));
      return () => ({ html: document.createElement('input'), title: name });
    },
  });
  const outlet = document.createElement('main');
  outlet.id = rootOutletId;
  Object.assign(outlet, { [outletDelegateAttribute]: {
    setElement: (node: Node) => outlet.replaceChildren(node), clear: () => outlet.replaceChildren(),
  } });
  document.body.replaceChildren(outlet);
  const router = new TestRouter(sitemap, impl, engine, new RenderedRouteCache(maxPages));
  disposals.push(() => router.dispose());
  await router.init();
  flush();
  return { router, engine, outlet, a, b, detail, sitemap, rendered, pagesDisposed,
    defaults: () => defaults, failB: () => { failB = true; } };
}

it.each([0, 10])('open, Back, Forward and close reuse the visible stack (budget %s)', async budget => {
  const f = await app(budget);
  const node = f.outlet.firstChild as HTMLInputElement;
  node.value = 'local state'; node.focus();
  const locator = f.router.currentLocator();
  const state = f.engine.currentEntry().getState!();
  const defaults = f.defaults();
  const status = f.router.rrCache.currentRoutes()[0].renderArgs.pageStatus;
  const fetching = status.fetchSignal();
  const title = vi.spyOn(document, 'title', 'set');
  const scroll = vi.spyOn(window, 'scrollTo');
  const enter = vi.fn(), cleanup = vi.fn();
  const handle = f.router.pushTransient(() => { enter(); return cleanup; });
  await handle.finished;
  expect(await handle.committed).toMatchObject({ id: f.engine.currentEntry().id });
  expect(f.engine.currentEntry().getState!()).toMatchObject({ ...state as object, id: f.engine.currentEntry().id, $transient: true });
  await f.engine.back().finished;
  await f.engine.forward().finished;
  await handle.close().finished;
  expect(f.engine.currentIndex()).toBe(1); // stale close never navigates
  expect(enter).toHaveBeenCalledOnce(); expect(cleanup).toHaveBeenCalledOnce();
  expect(f.router.records).toBe(0);
  expect(f.router.currentLocator()).toBe(locator);
  expect(f.defaults()).toBe(defaults);
  expect(f.outlet.firstChild).toBe(node);
  expect(node.value).toBe('local state'); expect(document.activeElement).toBe(node);
  expect(status.isVisible()).toBe(true); expect(status.hasFocus()).toBe(true);
  expect(status.fetchSignal()).toBe(fetching); expect(fetching?.aborted).toBe(false);
  expect(title).not.toHaveBeenCalled(); expect(scroll).not.toHaveBeenCalled();
  expect(f.rendered.a).toBe(1);
  expect(f.engine.entries()).toHaveLength(2);
});

it('close traverses, coalesces, and can retry cancellation without cleaning early', async () => {
  const f = await app();
  const cleanup = vi.fn();
  const handle = f.router.pushTransient(() => cleanup);
  await handle.finished;
  f.engine.hold = true;
  const first = handle.close();
  expect(handle.close()).toBe(first);
  expect(cleanup).not.toHaveBeenCalled();
  f.engine.requests.shift()!.cancel();
  await expect(first.finished).rejects.toMatchObject({ name: 'AbortError' });
  expect(cleanup).not.toHaveBeenCalled();
  const retry = handle.close();
  await retry.finished;
  expect(f.engine.currentIndex()).toBe(0);
  expect(cleanup).toHaveBeenCalledOnce();
  await handle.close().finished;
  expect(cleanup).toHaveBeenCalledOnce();
});

it('nested Back expires only the child; Forward preserves the live parent and parent close crosses expired entries', async () => {
  const f = await app(0);
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const closed: string[] = [];
  const parent = f.router.pushTransient(() => () => closed.push('parent'));
  await parent.finished;
  const child = f.router.pushTransient(() => () => closed.push('child'));
  await child.finished;
  expect(warning).toHaveBeenCalledOnce();
  await parent.close().finished;
  expect(f.engine.currentIndex()).toBe(2);
  await f.engine.back().finished;
  expect(closed).toEqual(['child']);
  await f.engine.forward().finished;
  await child.close().finished;
  expect(closed).toEqual(['child']);
  await parent.close().finished;
  expect(f.engine.currentIndex()).toBe(0);
  expect(closed).toEqual(['child', 'parent']);
  await f.engine.forward().finished;
  await f.engine.forward().finished;
  expect(f.router.records).toBe(0);
  expect(f.rendered.a).toBe(1);
});

it.each(['navigate', 'dispose'] as const)('%s cleans all nested callbacks innermost first, before page disposal', async action => {
  const f = await app(0);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const closed: string[] = [];
  f.router.pushTransient(() => () => { closed.push('parent'); expect(f.pagesDisposed).toEqual([]); });
  f.router.pushTransient(() => () => { closed.push('child'); expect(f.pagesDisposed).toEqual([]); });
  if (action === 'dispose') f.router.dispose();
  else {
    await f.router.navigate(f.b.locate({})).finished;
    expect(f.engine.entries().map(entry => entry.url)).toEqual(['/a', '/a', '/b']);
    await f.engine.back().finished;
    expect(f.router.records).toBe(0); // expired parent never revives
  }
  expect(closed).toEqual(['child', 'parent']);
  expect(f.router.records).toBe(0);
});

it.each(['push', 'replace'] as const)('managed %s replaces the transient and cleans at commit even on render failure', async mode => {
  const f = await app();
  const original = f.engine.currentEntry();
  const cleanup = vi.fn();
  await f.router.pushTransient(() => cleanup).finished;
  const transient = f.engine.currentEntry();
  f.failB();
  await expect(f.router.navigate(f.b.locate({}), { mode }).finished).rejects.toThrow('B failed');
  expect(cleanup).toHaveBeenCalledOnce();
  expect(f.engine.entries()).toHaveLength(2);
  expect(f.engine.currentEntry()).toMatchObject({ key: transient.key });
  expect(f.engine.currentEntry().id).not.toBe(transient.id);
  expect(f.engine.currentEntry().getState!()).not.toHaveProperty('$transient');
  expect(f.engine.entries()[0].getState!()).toMatchObject({ id: original.id, snapShotByKey: { token: 1 } });
  expect(() => f.router.pushTransient(() => {})).toThrow('fully activated');
});

it.each(['url', 'state', 'persistence'] as const)('a committed departure cleans nested interactions when %s fails', async failure => {
  const f = await app(0);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const closed: string[] = [];
  const parent = f.router.pushTransient(() => () => closed.push('parent'));
  await parent.finished;
  const child = f.router.pushTransient(() => () => closed.push('child'));
  await child.finished;
  const outgoing = f.engine.currentEntry().id;
  const persist = f.engine.updateCurrentEntry.bind(f.engine);
  const persistence = vi.spyOn(f.engine, 'updateCurrentEntry').mockImplementation(state => {
    if (failure === 'persistence' && f.engine.currentEntry().id !== outgoing) throw new Error('Persistence failed');
    persist(state);
  });
  const navigation = f.engine.navigate({
    url: failure === 'url' ? '/missing' : '/b',
    state: failure === 'state' ? { slugs: [], snapShotByKey: {} } : undefined,
    history: 'push',
  });
  const committed = await navigation.committed;
  await expect(navigation.finished).rejects.toThrow({
    url: 'Couldnt find missing', state: 'Couldnt find route', persistence: 'Persistence failed',
  }[failure]);
  persistence.mockRestore();
  expect(closed).toEqual(['child', 'parent']);
  expect(f.router.records).toBe(0);
  expect(f.router.stacksByEntry.size).toBe(0);
  expect(f.pagesDisposed).toEqual([]);
  await child.close().finished;
  await parent.close().finished;
  expect(f.engine.currentEntry().id).toBe(committed?.id);
  await f.engine.back().finished;
  f.router.dispose();
  expect(closed).toEqual(['child', 'parent']);
});

it.each(['state', 'persistence'] as const)('close cleans the interaction even when destination %s fails', async failure => {
  const f = await app();
  const cleanup = vi.fn();
  const handle = f.router.pushTransient(() => cleanup);
  await handle.finished;
  const outgoing = f.engine.currentEntry().id;
  if (failure === 'state') {
    const predecessor = f.engine.entries()[0].getState!() as { slugs: string[] };
    predecessor.slugs = [];
  }
  const persist = f.engine.updateCurrentEntry.bind(f.engine);
  const persistence = vi.spyOn(f.engine, 'updateCurrentEntry').mockImplementation(state => {
    if (failure === 'persistence' && f.engine.currentEntry().id !== outgoing) throw new Error('Persistence failed');
    persist(state);
  });
  const close = handle.close();
  await expect(close.finished).rejects.toThrow(failure === 'state' ? 'Couldnt find route' : 'Persistence failed');
  persistence.mockRestore();
  expect(f.engine.currentIndex()).toBe(0);
  expect(cleanup).toHaveBeenCalledOnce();
  expect(f.router.records).toBe(0);
  await handle.close().finished;
  f.router.dispose();
  expect(cleanup).toHaveBeenCalledOnce();
});

it('cleanup after failed resolution can navigate without masking the failure or reviving interactions', async () => {
  const f = await app();
  let successor: EngineNavigationResult | undefined;
  const cleanup = vi.fn(() => { successor = f.router.navigate(f.b.locate({ token: 99 })); });
  await f.router.pushTransient(() => cleanup).finished;
  const failed = f.engine.navigate({ url: '/missing', state: undefined, history: 'push' });
  await expect(failed.finished).rejects.toThrow('Couldnt find missing');
  await successor?.finished;
  expect(f.router.currentLocator()).toMatchObject({ route: f.b, values: { token: 99 } });
  expect(f.router.records).toBe(0);
  f.router.dispose();
  expect(cleanup).toHaveBeenCalledOnce();
});

it('a departure cancelled before commit leaves the interaction open', async () => {
  const f = await app();
  const cleanup = vi.fn();
  const handle = f.router.pushTransient(() => cleanup);
  await handle.finished;
  const entry = f.engine.currentEntry().id;
  f.engine.hold = true;
  const cancelled = f.router.navigate(f.b.locate({}));
  f.engine.requests.shift()!.cancel();
  await expect(cancelled.finished).rejects.toMatchObject({ name: 'AbortError' });
  expect(f.engine.currentEntry().id).toBe(entry);
  expect(cleanup).not.toHaveBeenCalled();
  await handle.close().finished;
  expect(cleanup).toHaveBeenCalledOnce();
});

it('cleanup navigation cannot lose committed defaults or activate the superseded destination', async () => {
  const f = await app();
  let successor: EngineNavigationResult | undefined;
  await f.router.pushTransient(() => () => {
    expect(f.engine.currentEntry().getState!()).toMatchObject({ snapShotByKey: { token: 2 } });
    successor = f.router.navigate(f.a.locate({ token: 99 }));
  }).finished;
  const destination = f.router.navigate(f.b.locate({}));
  await expect(destination.finished).rejects.toMatchObject({ name: 'AbortError' });
  await successor?.finished;
  expect(f.engine.entries()[1].getState!()).toMatchObject({ snapShotByKey: { token: 2 } });
  expect(f.router.currentLocator()?.values).toEqual({ token: 99 });
  expect(f.rendered.b).toBe(0);
});

it('enter reentrantly navigates/disposes: its returned cleanup runs once immediately', async () => {
  for (const action of ['navigate', 'dispose'] as const) {
    const f = await app();
    const cleanup = vi.fn();
    let successor: EngineNavigationResult | undefined;
    const handle = f.router.pushTransient(() => {
      if (action === 'dispose') f.router.dispose();
      else successor = f.router.navigate(f.b.locate({}));
      return cleanup;
    });
    await expect(handle.finished).rejects.toMatchObject({ name: 'AbortError' });
    await successor?.finished;
    expect(cleanup).toHaveBeenCalledOnce();
    expect(f.router.records).toBe(0);
  }
});

it('reentrant child opening retains its parent, including when child enter throws', async () => {
  const f = await app();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const cleanup = vi.fn();
  let child: TransientHandle | undefined;
  const parent = f.router.pushTransient(() => {
    child = f.router.pushTransient(() => { throw new Error('child enter failed'); });
    return cleanup;
  });
  await expect(parent.finished).rejects.toMatchObject({ name: 'AbortError' });
  await expect(child!.finished).rejects.toThrow('child enter failed');
  expect(cleanup).not.toHaveBeenCalled();
  expect(f.router.records).toBe(1);
  await parent.close().finished;
  expect(f.engine.currentIndex()).toBe(0);
  expect(cleanup).toHaveBeenCalledOnce();
});

it('cleanup failures and reentrant close/dispose do not stop or duplicate the cleanup batch', async () => {
  const f = await app();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const report = vi.spyOn(console, 'error').mockImplementation(() => {});
  const cleanup = vi.fn();
  const parent = f.router.pushTransient(() => cleanup);
  const child = f.router.pushTransient(() => () => {
    parent.close(); f.router.dispose(); throw new Error('cleanup failed');
  });
  await expect(f.router.navigate(f.b.locate({})).finished).rejects.toMatchObject({ name: 'AbortError' });
  expect(cleanup).toHaveBeenCalledOnce();
  expect(report).toHaveBeenCalledOnce();
  await child.close().finished;
  expect(f.router.records).toBe(0);
});

it('an aborted opening signal does not close an entered interaction', async () => {
  const f = await app();
  const cleanup = vi.fn();
  const handle = f.router.pushTransient(() => cleanup);
  await handle.finished;
  f.engine.abort();
  expect(cleanup).not.toHaveBeenCalled();
  await handle.close().finished;
  expect(cleanup).toHaveBeenCalledOnce();
});

it('cancelled and overlapping pending opens release only their own callbacks', async () => {
  const f = await app();
  const enter = vi.fn(), other = vi.fn();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  f.engine.hold = true;
  const one = f.router.pushTransient(enter);
  f.engine.hold = true;
  const two = f.router.pushTransient(other);
  f.engine.requests.shift()!.cancel();
  await expect(one.finished).rejects.toMatchObject({ name: 'AbortError' });
  f.engine.requests.shift()!.commit();
  await two.finished;
  expect(enter).not.toHaveBeenCalled(); expect(other).toHaveBeenCalledOnce();
  expect(f.router.records).toBe(1);
  await two.close().finished;
  expect(f.engine.currentIndex()).toBe(0);
  expect(f.router.records).toBe(0);
});

it.each([false, true])('early close suppresses enter and never undoes a newer child (%s)', async child => {
  const f = await app();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  f.engine.hold = true;
  const enter = vi.fn();
  const handle = f.router.pushTransient(enter);
  const close = handle.close();
  f.engine.requests.shift()!.commit();
  if (child) f.router.pushTransient(() => {});
  await close.finished;
  expect(enter).not.toHaveBeenCalled();
  expect(f.engine.currentIndex()).toBe(child ? 2 : 0);
});

it('early close returns from its committed entry even if opening is cancelled after commit', async () => {
  const f = await app();
  const initial = f.engine.currentEntry().id;
  const update = f.engine.updateCurrentEntry.bind(f.engine);
  const spy = vi.spyOn(f.engine, 'updateCurrentEntry').mockImplementation(state => {
    update(state);
    if (f.engine.currentEntry().id !== initial) f.engine.abort();
  });
  f.engine.hold = true;
  const enter = vi.fn();
  const handle = f.router.pushTransient(enter);
  const close = handle.close();
  f.engine.requests.shift()!.commit();
  await expect(handle.finished).rejects.toMatchObject({ name: 'AbortError' });
  spy.mockRestore();
  await close.finished;
  expect(f.engine.currentIndex()).toBe(0);
  expect(enter).not.toHaveBeenCalled();
  expect(f.router.records).toBe(0);
});

it('early close never undoes an ordinary successor', async () => {
  const f = await app();
  f.engine.hold = true;
  const enter = vi.fn();
  const handle = f.router.pushTransient(enter);
  const close = handle.close();
  f.engine.requests.shift()!.commit();
  await f.router.navigate(f.b.locate({})).finished;
  await close.finished;
  expect(f.engine.currentIndex()).toBe(1);
  expect(f.router.currentLocator()?.route).toBe(f.b);
  expect(enter).not.toHaveBeenCalled();
});

it.each([false, true])('missing/replaced predecessor (%s) is a no-op even with a surviving key', async replace => {
  const f = await app();
  const predecessor = f.engine.currentEntry().id;
  const cleanup = vi.fn();
  const handle = f.router.pushTransient(() => cleanup);
  await handle.finished;
  f.engine.forget(predecessor, replace);
  await handle.close().finished;
  expect(cleanup).not.toHaveBeenCalled();
  expect(f.router.records).toBe(1);
  f.router.dispose();
  expect(cleanup).toHaveBeenCalledOnce();
});

it('disposing a parent entry removes only its stack, not its live interaction in a descendant', async () => {
  const f = await app(0);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const cleanup = vi.fn();
  const parent = f.router.pushTransient(() => cleanup);
  const parentId = f.engine.currentEntry().id;
  await parent.finished;
  await f.router.pushTransient(() => {}).finished;
  await f.engine.back().finished;
  await f.engine.forward().finished;
  f.engine.forget(parentId);
  expect(f.router.stacksByEntry.has(parentId)).toBe(false);
  expect(cleanup).not.toHaveBeenCalled();
  await parent.close().finished;
  expect(f.engine.currentIndex()).toBe(0);
  expect(cleanup).toHaveBeenCalledOnce();
  expect(f.rendered.a).toBe(1);
});

it('expired and restored markers still replace managed pushes and never become menu bookmarks', async () => {
  const f = await app();
  const original = f.engine.currentEntry();
  await f.router.pushTransient(() => {}).finished;
  await f.engine.back().finished;
  await f.engine.forward().finished;
  expect(f.router.resolveDestination(f.b.locate({})).operation.type).toBe('replace');
  // menu at the root is a genuine no-op, and must not dismiss a live interaction.
  const cleanup = vi.fn();
  await f.router.pushTransient(() => cleanup).finished;
  await f.router.navigate(f.a.locate({}), { mode: 'menu' }).finished;
  expect(cleanup).not.toHaveBeenCalled();
  await f.router.navigate(f.b.locate({})).finished;
  expect(f.router.resolveDestination(f.a.locate({}), 'menu').operation).toEqual({ type: 'traverse', id: original.id, key: original.key });
  const marked = f.engine.entries()[1];
  await f.engine.traverseTo(marked.key).finished;
  f.router.dispose();
  const fresh = await app(10, f.engine);
  expect(f.engine.currentEntry().getState!()).toHaveProperty('$transient', true);
  await fresh.router.navigate(fresh.b.locate({})).finished;
  expect(fresh.router.resolveDestination(fresh.a.locate({}), 'menu').operation.type).toBe('push');
});

it('menu root traversal excludes marked roots and preserves traversal rather than replacing', async () => {
  const f = await app();
  const original = f.engine.currentEntry();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  await f.router.pushTransient(() => {}).finished;
  await f.router.pushTransient(() => {}).finished;
  await f.router.navigate(f.detail.locate({})).finished;
  const destination = f.router.resolveDestination(f.a.locate({}), 'menu');
  expect(destination.operation).toEqual({ type: 'traverse', id: original.id, key: original.key });
  await f.router.activateDestination(destination).finished;
  expect(f.engine.currentIndex()).toBe(0);
  expect(f.engine.entries()).toHaveLength(3);
});

it('cleanup during a transient traversal can open a new child without expiring it', async () => {
  const f = await app();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const parentCleanup = vi.fn(), newCleanup = vi.fn();
  const parent = f.router.pushTransient(() => parentCleanup);
  await parent.finished;
  let child: TransientHandle | undefined;
  await f.router.pushTransient(() => () => { child = f.router.pushTransient(() => newCleanup); }).finished;
  await expect(f.engine.back().finished).rejects.toMatchObject({ name: 'AbortError' });
  await child?.finished;
  expect(f.router.records).toBe(2);
  expect(parentCleanup).not.toHaveBeenCalled(); expect(newCleanup).not.toHaveBeenCalled();
  await child?.close().finished;
  await parent.close().finished;
  expect(parentCleanup).toHaveBeenCalledOnce(); expect(newCleanup).toHaveBeenCalledOnce();
});

it('ordinary same-URL navigation is not a transient fast path, and stale plans revalidate replacement', async () => {
  const f = await app();
  const snapshot = f.router.resolveDestination(f.a.locate({ token: 7 }));
  const cleanup = vi.fn();
  await f.router.pushTransient(() => cleanup).finished;
  await f.router.activateDestination(snapshot).finished;
  expect(f.engine.entries()).toHaveLength(2);
  expect(cleanup).toHaveBeenCalledOnce();
  expect(f.router.currentLocator()?.values).toEqual({ token: 7 });
});

it('rejects inactive/disposed facade calls and openings before full activation', async () => {
  const f = await app();
  const facade = new Router(f.sitemap, { engine: new MemoryEngine('/a') });
  expect(() => facade.pushTransient(() => {})).toThrow('not active');
  facade.dispose();
  expect(() => facade.pushTransient(() => {})).toThrow('not active');
  f.router.dispose();
  expect(() => f.router.pushTransient(() => {})).toThrow('fully activated');
});

it('state persistence and cache callbacks can supersede opening without invoking enter', async () => {
  for (const stage of ['state', 'cache'] as const) {
    const f = await app(0);
    const initial = f.engine.currentEntry().id;
    const enter = vi.fn();
    let successor: EngineNavigationResult | undefined;
    let redirected = false;
    const redirect = () => {
      if (!redirected && f.engine.currentEntry().id !== initial) {
        redirected = true;
        successor = f.router.navigate(f.b.locate({}));
      }
    };
    if (stage === 'state') {
      const update = f.engine.updateCurrentEntry.bind(f.engine);
      vi.spyOn(f.engine, 'updateCurrentEntry').mockImplementation(state => { update(state); redirect(); });
    } else {
      const mark = f.router.rrCache.markUsedFor.bind(f.router.rrCache);
      vi.spyOn(f.router.rrCache, 'markUsedFor').mockImplementation((...args) => { mark(...args); redirect(); });
    }
    await expect(f.router.pushTransient(enter).finished).rejects.toMatchObject({ name: 'AbortError' });
    await successor?.finished;
    expect(enter).not.toHaveBeenCalled();
    expect(f.router.records).toBe(0);
    expect(f.router.currentLocator()?.route).toBe(f.b);
    f.router.dispose();
  }
});

it('rechecks the current ID before close traversal and does not undo a successor', async () => {
  const f = await app();
  const handle = f.router.pushTransient(() => {});
  await handle.finished;
  const entries = f.engine.entries.bind(f.engine);
  let successor: EngineNavigationResult | undefined;
  vi.spyOn(f.engine, 'entries').mockImplementationOnce(() => {
    const result = entries();
    successor = f.router.navigate(f.b.locate({}));
    return result;
  });
  await handle.close().finished;
  await successor?.finished;
  expect(f.router.currentLocator()?.route).toBe(f.b);
});

it('pending cancellation after early close never enters or leaves retained callbacks', async () => {
  const f = await app();
  f.engine.hold = true;
  const enter = vi.fn();
  const handle = f.router.pushTransient(enter);
  const close = handle.close();
  f.engine.requests.shift()!.cancel();
  await expect(handle.finished).rejects.toMatchObject({ name: 'AbortError' });
  await close.finished;
  expect(enter).not.toHaveBeenCalled();
  expect(f.router.records).toBe(0);
  expect(f.engine.entries()).toHaveLength(1);
});

it('speculation remains side-effect free and its output is adopted after opening changes push to replace', async () => {
  const f = await app();
  const snapshot = f.router.resolveDestination(f.b.locate({ token: 77 }));
  const lease = f.router.acquirePreparation(snapshot)!;
  const prepared = await lease.ready;
  expect(f.engine.entries()).toHaveLength(1);
  expect(f.router.records).toBe(0);
  const cleanup = vi.fn();
  await f.router.pushTransient(() => cleanup).finished;
  await f.router.activateDestination(snapshot).finished;
  lease.release();
  expect(f.router.rrCache.currentRoutes()[0]).toBe(prepared.routes[0]);
  expect(f.rendered.b).toBe(1);
  expect(f.engine.entries()).toHaveLength(2);
  expect(cleanup).toHaveBeenCalledOnce();
});

it('open copies the engine URL verbatim instead of rebuilding it from the locator', async () => {
  const f = await app();
  const current = f.engine.currentEntry.bind(f.engine);
  vi.spyOn(f.engine, 'currentEntry').mockImplementation(() => ({ ...current(), url: '/a?unmanaged=keep#anchor' }));
  await f.router.pushTransient(() => {}).finished;
  expect(f.engine.entries()[1].url).toBe('/a?unmanaged=keep#anchor');
});

it('alias normalization preserves the marker and the resolved state', async () => {
  const f = await app();
  const alias = route({ token: param.hidden<number>() }).aliasTo(({ token }) => f.a.locate({ token }));
  const sitemap = root({ alias, a: f.a });
  const state = AppState.fromLocator(alias.locate({ token: 42 }));
  state.transient = true;
  const impl = new SolidImplementationMap<{}, {}>(sitemap);
  impl.implement(f.a, { untrackedKeys: [], async render() { return () => ({ html: document.createElement('div'), title: 'a' }); } });
  const engine = new MemoryEngine('/alias');
  engine.updateCurrentEntry(state.serialize(sitemap));
  f.router.dispose();
  const router = new TestRouter(sitemap, impl, engine);
  disposals.push(() => router.dispose());
  await router.init();
  expect(engine.currentEntry().getState!()).toMatchObject({ $transient: true, snapShotByKey: { token: 42 } });
});
