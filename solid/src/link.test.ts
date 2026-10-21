import { afterEach, expect, it, vi } from 'vitest';
import { index, param, root, route, type Route } from '@kinetic-router/definition';
import { createComponent, createOwner, createSignal, Errored, flush, onCleanup, runWithOwner } from 'solid-js';
import { render } from '@solidjs/web';
import { Router } from './router.js';
import { MemoryEngine } from './memory-engine.js';
import { frameDelegateAttribute, rootFrameId } from './frame.js';
import { Link, type LinkProps, type Prefetch } from './link.js';
import type { PagePreparationContext } from './page.js';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function settle() {
  for (let i = 0; i < 30; i++) { await Promise.resolve(); flush(); }
}
async function app(prefetch?: Prefetch, slow = false, fail = false) {
  const home = route({}), a = route({}), detail = route({}), b = route({});
  const hidden = route({ secret: param.hidden<{ value: number }>().optional() });
  const results = route({ q: param.search<string>().withDefault('all') });
  const sitemap = root({ home, a: { [index]: a, detail }, b, hidden, results });
  const engine = new MemoryEngine('/home');
  const owner = createOwner();
  cleanups.push(() => owner.dispose());
  const router = runWithOwner(owner, () => new Router(sitemap, { engine, prefetch, prefetchCache: { maxEntries: 0 } }));
  const contexts: Record<string, PagePreparationContext[]> = { home: [], a: [], detail: [], b: [], hidden: [], results: [] };
  const disposed = { home: 0, a: 0, detail: 0, b: 0, hidden: 0, results: 0 };
  const gate = Promise.withResolvers<void>();
  cleanups.push(() => gate.resolve());
  for (const name of ['home', 'a', 'detail', 'b', 'hidden', 'results'] as const) {
    router.implement({ home, a, detail, b, hidden, results }[name] as Route<any>, {
      untrackedKeys: [],
      async render(_params, context) {
        contexts[name].push(context);
        onCleanup(() => disposed[name]++);
        if (fail && name === 'a' && contexts.a.length === 1) throw new Error('Preparation failed');
        if (slow && name !== 'home') await gate.promise;
        return () => ({ html: document.createElement('section'), title: name });
      },
    });
  }
  const frame = document.createElement('main');
  frame.id = rootFrameId;
  Object.assign(frame, { [frameDelegateAttribute]: {
    setElement: (node: Node) => frame.replaceChildren(node), clear: () => frame.replaceChildren(),
  } });
  document.body.replaceChildren(frame);
  const link = (props: LinkProps<any> = { route: a }) => {
    const host = document.createElement('div');
    document.body.append(host);
    const dispose = render(() => createComponent(Link, props), host);
    cleanups.push(dispose);
    const anchor = host.querySelector('a')!;
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 100, bottom: 40 } as DOMRect);
    return { anchor, dispose };
  };
  // A valid URL is available synchronously, before the initialization microtask.
  const initial = link({ route: a });
  expect(initial.anchor).toBeInstanceOf(HTMLAnchorElement);
  expect(initial.anchor.getAttribute('href')).toBe('/a');
  expect(contexts.a).toHaveLength(0);
  initial.dispose();
  await settle();
  expect(router.currentLocator()?.route).toBe(home);
  return { router, owner, engine, link, contexts, disposed, gate, routes: { home, a, detail, b, hidden, results } };
}
function pointer(anchor: Element, type: string, init: PointerEventInit = {}) {
  anchor.dispatchEvent(new PointerEvent(type, {
    bubbles: !['pointerenter', 'pointerleave'].includes(type), cancelable: true,
    pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, clientX: 5, clientY: 5, ...init,
  }));
}
function click(anchor: HTMLAnchorElement, init: MouseEventInit = {}) {
  // Observe the managed handler before suppressing happy-dom's real URL loading.
  let prevented = false;
  const preventNative = (event: MouseEvent) => { prevented = event.defaultPrevented; event.preventDefault(); };
  document.addEventListener('click', preventNative, { once: true });
  anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init }));
  return prevented;
}

it.each([undefined, false])('disables speculation by default (%s), but still navigates on click', async prefetch => {
  const a = await app(prefetch);
  const { anchor } = a.link({ route: a.routes.a });
  vi.useFakeTimers();
  pointer(anchor, 'pointerenter'); pointer(anchor, 'pointerdown'); anchor.focus();
  await vi.advanceTimersByTimeAsync(1000);
  expect(a.contexts.a).toHaveLength(0);
  expect(click(anchor)).toBe(true);
  await settle();
  expect(a.contexts.a).toHaveLength(1);
  expect(a.engine.entries()).toHaveLength(2);
});

it('revalidates a bare alias after its caller changes the destination during click', async () => {
  const a = await app({ hover: 0, focus: false });
  let target = a.routes.a;
  const alias = route({}).aliasTo(() => target.locate({}));
  const { anchor } = a.link({ route: alias, onClick: () => { target = a.routes.b; } });
  expect(anchor.getAttribute('href')).toBe('/a');
  pointer(anchor, 'pointerenter');
  await settle();
  expect(a.contexts.a).toHaveLength(1);
  click(anchor);
  await settle();
  expect(a.router.currentLocator()?.route).toBe(a.routes.b);
  expect(a.contexts.b).toHaveLength(1);
  expect(a.contexts.b[0].pageStatus.isVisible()).toBe(true);
  expect(document.title).toBe('b');
  expect(anchor.getAttribute('href')).toBe('/b');
  expect(a.contexts.a[0].pageStatus.isVisible()).toBe(false);
});

it('joins navigation-owned construction and keeps it alive when navigation is superseded', async () => {
  const a = await app({ hover: 0, focus: false }, true);
  const { anchor } = a.link({ route: a.routes.a });
  const navigation = a.router.navigate(a.routes.a.locate({}));
  const outcome = Promise.resolve(navigation.finished).catch((error: unknown) => error);
  await settle();
  pointer(anchor, 'pointerenter');
  await settle();
  expect(a.contexts.a).toHaveLength(1);
  const context = a.contexts.a[0];
  await a.router.navigate(a.routes.home.locate({})).finished;
  expect(context.signal.aborted).toBe(false);
  pointer(anchor, 'pointerleave');
  expect(context.signal.aborted).toBe(true);
  a.gate.resolve();
  expect(await outcome).toMatchObject({ name: 'AbortError' });
  expect(a.disposed.a).toBe(1);
  expect(a.router.currentLocator()?.route).toBe(a.routes.home);
});

it('shares normalized defaults between a bare Link, preparation, click and URL navigation', async () => {
  const a = await app({ hover: 0, focus: false });
  const { anchor } = a.link({ route: a.routes.results });
  expect(anchor.getAttribute('href')).toBe('/results');
  pointer(anchor, 'pointerenter');
  await settle();
  const explicit = a.router.acquirePreparation(a.router.resolveDestination(a.routes.results.locate({ q: 'all' })))!;
  const prepared = await explicit.ready;
  expect(a.contexts.results).toHaveLength(1);
  expect((prepared.routes[0].renderArgs.params.reactiveProxyObject as { q: string }).q).toBe('all');
  click(anchor);
  await settle();
  explicit.release();
  pointer(anchor, 'pointerleave');
  expect(a.contexts.results).toHaveLength(1);
  expect(a.router.currentLocator()?.values).toEqual({ q: 'all' });
  expect(a.router.toLocator(new URL(anchor.href)).values).toEqual({ q: 'all' });
  await a.engine.back().finished;
  await a.engine.forward().finished;
  expect(a.router.currentLocator()?.values).toEqual({ q: 'all' });
  // Ordinary anchors carry no serialized AppState.
  await a.engine.navigate({ url: '/results', state: undefined, history: 'push' }).finished;
  expect(a.router.currentLocator()?.values).toEqual({ q: 'all' });
});

it('inherits object options, preserves them for true, and lets Link objects enable and override individual fields', async () => {
  const a = await app({ hover: false, press: false, focus: false });
  const disabled = a.link({ route: a.routes.a, prefetch: true }).anchor;
  const enabled = a.link({ route: a.routes.b, prefetch: { hover: 25 } }).anchor;
  vi.useFakeTimers();
  pointer(disabled, 'pointerenter'); pointer(disabled, 'pointerdown'); disabled.focus();
  pointer(enabled, 'pointerenter');
  await vi.advanceTimersByTimeAsync(24);
  expect(a.contexts.b).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(1);
  expect(a.contexts.b).toHaveLength(1);
  expect(a.contexts.a).toHaveLength(0);
  a.owner.dispose();
  const b = await app(false);
  pointer(b.link({ route: b.routes.a, prefetch: true }).anchor, 'pointerdown');
  await settle();
  expect(b.contexts.a).toHaveLength(1);
});

it.each(['hover', 'focus', 'cancelDelay'] as const)('validates finite nonnegative %s values at both levels, even when overridden', async key => {
  for (const value of [-1, NaN, Infinity]) {
    const owner = createOwner();
    expect(() => runWithOwner(owner, () => new Router(root({ home: route({}) }), { prefetch: { [key]: value } }))).toThrow(RangeError);
    owner.dispose();
  }
  const a = await app();
  for (const value of [-1, NaN, Infinity]) {
    const host = document.createElement('div');
    const dispose = render(() => createComponent(Errored, {
      fallback: error => String(error()),
      get children() { return createComponent(Link, { route: a.routes.a, prefetch: { [key]: value } }); },
    }), host);
    expect(host.textContent).toContain(`prefetch.${key} must be finite and non-negative`);
    dispose();
  }
});

it('requires continuous hover, ignores touch enter and descendant movement, and starts once', async () => {
  const a = await app(true);
  const { anchor } = a.link({ route: a.routes.a });
  const child = document.createElement('span'); anchor.append(child);
  vi.useFakeTimers();
  pointer(anchor, 'pointerenter', { pointerType: 'touch' });
  await vi.advanceTimersByTimeAsync(100);
  expect(a.contexts.a).toHaveLength(0);
  pointer(anchor, 'pointerenter');
  await vi.advanceTimersByTimeAsync(74);
  pointer(anchor, 'pointerleave');
  await vi.advanceTimersByTimeAsync(100);
  expect(a.contexts.a).toHaveLength(0);
  pointer(anchor, 'pointerenter');
  await vi.advanceTimersByTimeAsync(50);
  pointer(child, 'pointerover'); pointer(child, 'pointerenter');
  await vi.advanceTimersByTimeAsync(25);
  expect(a.contexts.a).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(100);
  expect(a.contexts.a).toHaveLength(1);
});

it('shares hover, focus and press work and keeps independent interests alive', async () => {
  const a = await app(true, true);
  const { anchor } = a.link({ route: a.routes.a });
  vi.useFakeTimers();
  pointer(anchor, 'pointerenter');
  anchor.focus();
  await vi.advanceTimersByTimeAsync(25);
  pointer(anchor, 'pointerdown'); // bypass hover/focus delays
  await settle();
  expect(a.contexts.a).toHaveLength(1);
  const context = a.contexts.a[0];
  pointer(anchor, 'pointercancel');
  expect(context.signal.aborted).toBe(false); // promoted hover still owns it
  pointer(anchor, 'pointerleave');
  expect(context.signal.aborted).toBe(false); // existing keyboard focus is independent
  anchor.blur();
  expect(context.signal.aborted).toBe(true);

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  anchor.blur(); anchor.focus();
  pointer(anchor, 'pointerenter');
  await vi.advanceTimersByTimeAsync(75);
  expect(a.contexts.a).toHaveLength(2);
  pointer(anchor, 'pointerleave');
  expect(a.contexts.a[1].signal.aborted).toBe(false);
  anchor.blur();
  expect(a.contexts.a[1].signal.aborted).toBe(true);
});

it('shares work across Links and honors each cancellation grace, with immediate disabling and unmount', async () => {
  const a = await app(true, true);
  const [enabled, setEnabled] = createSignal<Prefetch>({ hover: 0, cancelDelay: 100 });
  const one = a.link({ route: a.routes.a, prefetch: { hover: 0, cancelDelay: 20 } });
  const two = a.link({ route: a.routes.a, get prefetch() { return enabled(); } });
  vi.useFakeTimers();
  pointer(one.anchor, 'pointerenter'); pointer(two.anchor, 'pointerenter');
  await settle();
  const context = a.contexts.a[0];
  expect(a.contexts.a).toHaveLength(1);
  pointer(one.anchor, 'pointerleave'); pointer(two.anchor, 'pointerleave');
  await vi.advanceTimersByTimeAsync(20);
  expect(context.signal.aborted).toBe(false);
  setEnabled(false); flush();
  expect(context.signal.aborted).toBe(true);
  pointer(one.anchor, 'pointerenter');
  await settle();
  one.dispose();
  expect(a.contexts.a[1].signal.aborted).toBe(true);
});

it.each([false, true])('keeps each Link cancellation grace independent (reverse release: %s)', async reverse => {
  const a = await app({ hover: 0, focus: false }, true);
  const short = a.link({ route: a.routes.a, prefetch: { cancelDelay: 20 } });
  const long = a.link({ route: a.routes.a, prefetch: { cancelDelay: 100 } });
  vi.useFakeTimers();
  pointer(short.anchor, 'pointerenter'); pointer(long.anchor, 'pointerenter');
  await settle();
  const context = a.contexts.a[0];
  expect(a.contexts.a).toHaveLength(1);
  pointer((reverse ? long : short).anchor, 'pointerleave');
  pointer((reverse ? short : long).anchor, 'pointerleave');
  await vi.advanceTimersByTimeAsync(20);
  expect(context.signal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(79);
  expect(context.signal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(context.signal.aborted).toBe(true);
  expect(a.disposed.a).toBe(1);
});

it('preserves another Link interest after adoption until that Link releases it', async () => {
  const a = await app({ hover: 0, focus: false });
  const one = a.link({ route: a.routes.a }), two = a.link({ route: a.routes.a });
  pointer(one.anchor, 'pointerenter'); pointer(two.anchor, 'pointerenter');
  await settle();
  const status = a.contexts.a[0].pageStatus;
  const fetching = status.fetchSignal()!;
  click(one.anchor);
  await settle();
  pointer(one.anchor, 'pointerleave');
  await a.router.navigate(a.routes.b.locate({})).finished;
  await settle();
  expect(status.isVisible()).toBe(false);
  expect(status.shouldFetch()).toBe(true);
  expect(status.fetchSignal()).toBe(fetching);
  expect(fetching.aborted).toBe(false);
  two.dispose();
  flush();
  expect(fetching.aborted).toBe(true);
  expect(status.shouldFetch()).toBe(false);
});

it('does not extend cancellation grace for events that held no speculative interest', async () => {
  const a = await app({ hover: 0, focus: false, press: false, cancelDelay: 20 }, true);
  const { anchor } = a.link({ route: a.routes.a });
  vi.useFakeTimers();
  pointer(anchor, 'pointerenter'); await settle();
  pointer(anchor, 'pointerleave');
  await vi.advanceTimersByTimeAsync(10);
  anchor.focus(); anchor.blur();
  await vi.advanceTimersByTimeAsync(10);
  expect(a.contexts.a[0].signal.aborted).toBe(true);
});

it.each(['pointercancel', 'contextmenu', 'dragstart', 'outside', 'timeout', 'window-blur'] as const)('releases abandoned press: %s', async reason => {
  const a = await app({ hover: false, focus: false }, true);
  const { anchor } = a.link({ route: a.routes.a });
  vi.useFakeTimers();
  pointer(anchor, 'pointerdown', { pointerType: 'touch' });
  anchor.focus();
  await settle();
  const context = a.contexts.a[0];
  if (reason === 'window-blur') window.dispatchEvent(new Event('blur'));
  else if (reason === 'outside') pointer(anchor, 'pointerup', { pointerType: 'touch', clientX: 500 });
  else if (reason === 'timeout') {
    pointer(anchor, 'pointerup', { pointerType: 'touch' });
    pointer(anchor, 'lostpointercapture', { pointerType: 'touch' });
    pointer(anchor, 'pointerleave', { pointerType: 'touch' });
    await vi.advanceTimersByTimeAsync(399);
    expect(context.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
  } else pointer(anchor, reason, { pointerType: 'touch' });
  expect(context.signal.aborted).toBe(true);
  expect(a.disposed.a).toBe(1);
  a.gate.resolve(); await settle();
  expect(a.router.currentLocator()?.route).toBe(a.routes.home);
  expect(document.title).toBe('home');
});

it('adopts touch preparation before click cleanup and Link unmount, without waiting for rendering', async () => {
  const a = await app({ hover: false }, true);
  const { anchor, dispose } = a.link({ route: a.routes.a, mode: 'replace' });
  pointer(anchor, 'pointerdown', { pointerType: 'touch' });
  anchor.focus();
  await settle();
  const context = a.contexts.a[0];
  pointer(anchor, 'pointerup', { pointerType: 'touch' });
  pointer(anchor, 'lostpointercapture', { pointerType: 'touch' });
  pointer(anchor, 'pointerleave', { pointerType: 'touch' });
  expect(click(anchor)).toBe(true);
  dispose();
  expect(context.signal.aborted).toBe(false);
  expect(a.engine.entries()).toHaveLength(1);
  a.gate.resolve(); await settle();
  expect(a.contexts.a).toHaveLength(1);
  expect(a.router.currentLocator()?.route).toBe(a.routes.a);
  expect(context.pageStatus.isVisible()).toBe(true);
});

it.each([false, true])('holds press ownership while the caller unmounts the Link (cancelled: %s)', async cancelled => {
  const a = await app({ hover: false, focus: false }, true);
  let abortedInCaller: boolean | undefined;
  const { anchor, dispose } = a.link({ route: a.routes.a,
    onClick: event => {
      dispose();
      abortedInCaller = a.contexts.a[0].signal.aborted;
      if (cancelled) event.preventDefault();
    },
  });
  pointer(anchor, 'pointerdown', { pointerType: 'touch' });
  await settle();
  const context = a.contexts.a[0];
  click(anchor);
  await settle();
  expect(abortedInCaller).toBe(false);
  expect(context.signal.aborted).toBe(cancelled);
  expect(a.contexts.a).toHaveLength(1);
  expect(a.engine.entries()).toHaveLength(cancelled ? 1 : 2);
  a.gate.resolve(); await settle();
  expect(a.router.currentLocator()?.route).toBe(cancelled ? a.routes.home : a.routes.a);
  expect(a.disposed.a).toBe(cancelled ? 1 : 0);
});

it('keeps hover ownership and its cancellation grace when a caller cancels click', async () => {
  const a = await app({ hover: 0, focus: false, cancelDelay: 20 }, true);
  const { anchor } = a.link({ route: a.routes.a, onClick: event => event.preventDefault() });
  vi.useFakeTimers();
  pointer(anchor, 'pointerenter'); await settle();
  click(anchor);
  expect(a.contexts.a).toHaveLength(1);
  expect(a.contexts.a[0].signal.aborted).toBe(false);
  pointer(anchor, 'pointerleave');
  await vi.advanceTimersByTimeAsync(19);
  expect(a.contexts.a[0].signal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(a.contexts.a[0].signal.aborted).toBe(true);
});

it('does not keep ended gestures alive when pointer release/cancel handlers prevent default', async () => {
  const a = await app({ hover: false, focus: false }, true);
  const { anchor } = a.link({ route: a.routes.a,
    onPointerUp: event => event.preventDefault(), onPointerCancel: event => event.preventDefault(),
  });
  for (const event of ['pointerup', 'pointercancel']) {
    pointer(anchor, 'pointerdown'); await settle();
    pointer(anchor, event);
    expect(a.contexts.a.at(-1)!.signal.aborted).toBe(true);
  }
});

it('forwards reactive anchor attributes, children, refs and normal handler context', async () => {
  const a = await app();
  const [label, setLabel] = createSignal('One');
  let referenced: HTMLAnchorElement | undefined;
  const { anchor } = a.link({ route: a.routes.a,
    ref: element => { referenced = element; },
    get children() { return label(); }, get class() { return label().toLowerCase(); },
    'aria-label': 'A link',
    onClick: function(this: HTMLAnchorElement, event) {
      expect(this).toBe(anchor);
      expect(event.currentTarget).toBe(anchor);
      event.preventDefault();
    },
  });
  expect(referenced).toBe(anchor);
  expect(anchor.textContent).toBe('One');
  setLabel('Two'); flush();
  expect(anchor.textContent).toBe('Two');
  expect(anchor.className).toBe('two');
  expect(anchor.getAttribute('aria-label')).toBe('A link');
  click(anchor);
  expect(a.engine.entries()).toHaveLength(1);
});

it('leaves the active page unchanged on preparation failure and retries a later click normally', async () => {
  const a = await app({ hover: 0 }, false, true);
  const { anchor } = a.link({ route: a.routes.a });
  pointer(anchor, 'pointerenter'); await settle();
  expect(a.contexts.a).toHaveLength(1);
  expect(a.disposed.a).toBe(1);
  expect(a.engine.entries()).toHaveLength(1);
  expect(a.router.currentLocator()?.route).toBe(a.routes.home);
  expect(document.title).toBe('home');
  click(anchor); await settle();
  expect(a.contexts.a).toHaveLength(2);
  expect(a.router.currentLocator()?.route).toBe(a.routes.a);
});

it('runs caller handlers first, supports bound handlers, respects cancellation and releases cancelled clicks', async () => {
  const a = await app(true, true);
  const calls: string[] = [];
  const { anchor } = a.link({ route: a.routes.a,
    onPointerEnter: event => { calls.push('enter'); event.preventDefault(); },
    onClick: [(label: string, event: MouseEvent) => { calls.push(label); event.preventDefault(); }, 'click'],
  });
  vi.useFakeTimers();
  pointer(anchor, 'pointerenter');
  await vi.advanceTimersByTimeAsync(75);
  expect(a.contexts.a).toHaveLength(0);
  pointer(anchor, 'pointerdown', { pointerType: 'touch' });
  await settle();
  click(anchor);
  expect(calls).toEqual(['enter', 'click']);
  expect(a.contexts.a[0].signal.aborted).toBe(true);
  expect(a.engine.entries()).toHaveLength(1);
});

it.each([{ target: '_blank' }, { download: '' }, { target: 'another-window' }])('preserves native ineligible anchors: %j', async attributes => {
  const a = await app(true);
  const { anchor } = a.link({ route: a.routes.a, ...attributes });
  vi.useFakeTimers();
  pointer(anchor, 'pointerenter'); anchor.focus(); pointer(anchor, 'pointerdown');
  await vi.advanceTimersByTimeAsync(100);
  expect(a.contexts.a).toHaveLength(0);
  expect(click(anchor)).toBe(false);
  expect(a.engine.entries()).toHaveLength(1);
});

it.each([{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }, { button: 1 }, { button: 2 }])('leaves modified/nonprimary activation native: %j', async modifiers => {
  const a = await app({ hover: false, focus: false });
  const { anchor } = a.link({ route: a.routes.a });
  pointer(anchor, 'pointerdown', modifiers);
  await settle();
  expect(a.contexts.a).toHaveLength(0);
  expect(click(anchor, modifiers)).toBe(false);
  expect(a.engine.entries()).toHaveLength(1);
});

it('reacts to route, hidden values, mode, options and eligibility without leaking old timers or interests', async () => {
  const a = await app(true, true);
  const [target, setTarget] = createSignal(a.routes.a.locate({}));
  const [mode, setMode] = createSignal<'push' | 'menu'>('push');
  const [targetWindow, setTargetWindow] = createSignal('_self');
  const { anchor } = a.link({ get route() { return target(); }, get mode() { return mode(); }, get target() { return targetWindow(); } });
  vi.useFakeTimers();
  pointer(anchor, 'pointerenter');
  await vi.advanceTimersByTimeAsync(50);
  setTarget(a.routes.b.locate({})); flush();
  expect(anchor.getAttribute('href')).toBe('/b');
  await vi.advanceTimersByTimeAsync(25);
  expect(a.contexts.a).toHaveLength(0); expect(a.contexts.b).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(50);
  expect(a.contexts.b).toHaveLength(1);
  setTargetWindow('_blank'); flush();
  expect(a.contexts.b[0].signal.aborted).toBe(true);
  setTargetWindow('_self'); setTarget(a.routes.home.locate({})); setMode('menu'); flush();
  await vi.advanceTimersByTimeAsync(100);
  expect(a.contexts.home).toHaveLength(1); // no-op menu needs no preparation
  setMode('push'); setTarget(a.routes.hidden.locate({ secret: { value: 1 } })); flush();
  await vi.advanceTimersByTimeAsync(75);
  setTarget(a.routes.hidden.locate({ secret: { value: 2 } })); flush();
  expect(a.contexts.hidden[0].signal.aborted).toBe(true);
  await vi.advanceTimersByTimeAsync(75);
  expect(a.contexts.hidden).toHaveLength(2);
  expect(anchor.getAttribute('href')).toBe('/hidden');
});

it('uses reactive menu hrefs without losing the menu root and leaves bookmarks/history untouched on hover', async () => {
  const a = await app({ hover: 0 });
  const { anchor } = a.link({ route: a.routes.a, mode: 'menu' });
  await a.router.navigate(a.routes.a.locate({})).finished;
  await a.router.navigate(a.routes.detail.locate({})).finished;
  await a.router.navigate(a.routes.b.locate({})).finished;
  flush();
  expect(anchor.getAttribute('href')).toBe('/a/detail');
  const entries = a.engine.entries();
  pointer(anchor, 'pointerenter'); await settle();
  expect(a.engine.entries().map(e => [e.id, e.key, e.url, e.state])).toEqual(entries.map(e => [e.id, e.key, e.url, e.state]));
  click(anchor); await settle();
  expect(a.router.currentLocator()?.route).toBe(a.routes.detail);
  expect(anchor.getAttribute('href')).toBe('/a');
  click(anchor); await settle();
  expect(a.router.currentLocator()?.route).toBe(a.routes.a);
  click(anchor); await settle();
  expect(a.engine.entries()).toHaveLength(entries.length);
});

it('responds to saveData changes, preserves bypass/shared/navigation owners and never replays a press', async () => {
  const connection = Object.assign(new EventTarget(), { saveData: true, effectiveType: '2g' });
  vi.stubGlobal('navigator', { connection });
  const a = await app(true, true);
  const respected = a.link({ route: a.routes.a });
  const bypass = a.link({ route: a.routes.a, prefetch: { hover: 0, respectSaveData: false } });
  vi.useFakeTimers();
  pointer(respected.anchor, 'pointerenter'); pointer(respected.anchor, 'pointerdown'); respected.anchor.focus();
  await vi.advanceTimersByTimeAsync(100);
  expect(a.contexts.a).toHaveLength(0);
  connection.saveData = false; connection.dispatchEvent(new Event('change')); flush();
  await vi.advanceTimersByTimeAsync(74);
  expect(a.contexts.a).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(1);
  expect(a.contexts.a).toHaveLength(1);
  const context = a.contexts.a[0];
  pointer(bypass.anchor, 'pointerenter'); await settle();
  connection.saveData = true; connection.dispatchEvent(new Event('change')); flush();
  expect(context.signal.aborted).toBe(false);
  bypass.dispose();
  expect(context.signal.aborted).toBe(true);
  respected.anchor.blur();
  connection.saveData = false; connection.dispatchEvent(new Event('change')); flush();
  pointer(respected.anchor, 'pointerleave');
  await vi.advanceTimersByTimeAsync(1000);
  expect(a.contexts.a).toHaveLength(1); // no replay of the earlier down
  pointer(respected.anchor, 'pointerdown'); await settle();
  click(respected.anchor);
  connection.saveData = true; connection.dispatchEvent(new Event('change')); flush();
  expect(a.contexts.a[1].signal.aborted).toBe(false);
  a.gate.resolve(); await settle();
  expect(a.router.currentLocator()?.route).toBe(a.routes.a);
});

it('still navigates while data saving is respected and removes listeners/unfinished work on disposal', async () => {
  const connection = Object.assign(new EventTarget(), { saveData: true });
  const remove = vi.spyOn(connection, 'removeEventListener');
  vi.stubGlobal('navigator', { connection });
  const a = await app(true, true);
  const { anchor, dispose } = a.link({ route: a.routes.a });
  click(anchor); await settle();
  expect(a.contexts.a).toHaveLength(1);
  dispose();
  expect(remove).toHaveBeenCalledWith('change', expect.any(Function));
  expect(a.contexts.a[0].signal.aborted).toBe(false);
  a.gate.resolve(); await settle();
  expect(a.router.currentLocator()?.route).toBe(a.routes.a);
});

it('requires a Router before mounting Link', () => {
  expect(() => Link({ route: route({}) })).toThrow('Create a Router before rendering Link');
});

it('rejects overlapping Routers without replacing the active implementation', async () => {
  const a = await app(true);
  expect(() => new Router(root({ home: route({}) }))).toThrow('Only one Router can be active');
  expect(click(a.link({ route: a.routes.a }).anchor)).toBe(true);
  await settle();
  expect(a.router.currentLocator()?.route).toBe(a.routes.a);
});

it('releases registration and skips initialization when disposed before its microtask', async () => {
  const home = route({});
  const engine = new MemoryEngine('/home');
  const attach = vi.spyOn(engine, 'attach');
  const router = new Router(root({ home }), { engine });
  cleanups.push(router.dispose);
  router.dispose();
  await settle();
  expect(attach).not.toHaveBeenCalled();
  expect(router.currentLocator()).toBeUndefined();
  expect(() => Link({ route: home })).toThrow('Create a Router before rendering Link');
  const next = await app();
  expect(next.link().anchor.getAttribute('href')).toBe('/a');
});

it('releases an owned Router and never retargets existing Links to its replacement', async () => {
  const a = await app(true, true);
  const old = a.link({ route: a.routes.a }).anchor;
  pointer(old, 'pointerdown');
  await settle();
  expect(a.contexts.a).toHaveLength(1);
  a.owner.dispose();
  flush();
  expect(a.contexts.a[0].signal.aborted).toBe(true);
  expect(() => Link({ route: a.routes.a })).toThrow('Create a Router before rendering Link');

  const b = await app(true);
  a.router.dispose(); // An old cleanup must not unregister its replacement.
  document.body.append(old);
  pointer(old, 'pointerdown');
  expect(click(old)).toBe(false);
  await settle();
  expect(b.contexts.a).toHaveLength(0);
  expect(click(b.link({ route: b.routes.a }).anchor)).toBe(true);
  await settle();
  expect(b.router.currentLocator()?.route).toBe(b.routes.a);
});

it('explicit disposal releases active and cached page owners and detaches the engine', async () => {
  const a = await app();
  await a.router.navigate(a.routes.a.locate({})).finished;
  await a.router.navigate(a.routes.b.locate({})).finished;
  const fetching = a.contexts.b[0].pageStatus.fetchSignal()!;
  a.router.dispose();
  flush();
  expect(a.disposed).toMatchObject({ home: 1, a: 1, b: 1 });
  expect(fetching.aborted).toBe(true);
  expect(a.router.currentLocator()).toBeUndefined();
  expect(() => a.router.navigate(a.routes.a.locate({}))).toThrow('Router is not active');
  expect(() => a.engine.navigate({ url: '/a', state: undefined, history: 'push' })).toThrow('not attached');
  expect(() => Link({ route: a.routes.a })).toThrow('Create a Router before rendering Link');
});

// Compile-time public destination contract.
function destinationTypes() {
  const required = route({ id: param.path<string>() });
  Link({ route: required.locate({ id: 'one' }), ref: anchor => anchor.focus(), children: 'One' });
  Link({ route: route({ query: param.search<string>().optional() }) });
  // @ts-expect-error Required values must be explicit, never inherited from the active page.
  Link({ route: required });
  // @ts-expect-error href is derived from route.
  Link({ route: route({}), href: '/conflict' });
  // @ts-expect-error No separate section registry.
  Link({ route: route({}), section: 'one' });
}
void destinationTypes;
