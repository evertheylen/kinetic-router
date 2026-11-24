import { expect, it, vi } from 'vitest';
import { root, route } from '@kinetic-router/definition';
import { usePresenceScope } from '@kinetic-router/presence';
import { createComponent, flush, onCleanup } from 'solid-js';
import { insert, render } from '@solidjs/web';
import { MemoryEngine } from './memory-engine.js';
import { createOutlet, Outlet, outletDelegateAttribute, rootOutletId, type OutletDelegate } from './outlet.js';
import { Router } from './router.js';

it('connects to the router automatically and replaces page content inside its container', async () => {
  const home = route({}), next = route({});
  const router = new Router(root({ home, next }), { engine: new MemoryEngine('/home') });
  for (const [name, definition] of Object.entries({ home, next })) {
    router.implement(definition, {
      untrackedKeys: [],
      async render() {
        return () => {
          const html = document.createElement('section');
          html.textContent = name;
          return { html, title: name };
        };
      },
    });
  }
  const host = document.createElement('div');
  document.body.append(host);
  const dispose = render(() => createComponent(Outlet, { component: 'main', class: 'page-content' }), host);
  try {
    const outlet = host.querySelector('main')!;
    expect(outlet.id).toBe(rootOutletId);
    expect(outlet.className).toBe('page-content');
    await vi.waitFor(() => expect(router.currentLocator()?.route).toBe(home));
    expect(outlet.textContent).toBe('home');
    const initialPage = outlet.firstChild;

    await router.navigate(next.locate({})).finished;
    expect(host.querySelector('main')).toBe(outlet);
    expect(outlet.textContent).toBe('next');
    expect(outlet.childNodes).toHaveLength(1);
    expect(outlet.firstChild).not.toBe(initialPage);
  } finally {
    router.dispose();
    dispose();
    host.remove();
  }
});

const RetainingOutlet = createOutlet((outlet, node) => {
  const layer = document.createElement('div');
  layer.dataset.outgoing = '';
  outlet.append(layer);
  layer.append(node);
  return { node: layer };
});

type FixtureOptions = {
  rootMotion?: boolean;
  nestedMotion?: boolean;
  maxCachedPages?: number;
  alphaEntryOnly?: boolean;
  alphaTag?: string;
  prepareOutside?: () => Promise<void>;
};

async function presentationFixture({ rootMotion, nestedMotion, maxCachedPages, alphaEntryOnly, alphaTag, prepareOutside }: FixtureOptions) {
  const layout = route({}), alpha = layout.nestedRoute({}), beta = layout.nestedRoute({}), outside = route({});
  const engine = new MemoryEngine('/alpha');
  const router = new Router(root({ alpha, beta, outside }), { engine, maxCachedPages });
  const pages = new Map<string, HTMLElement>();
  const enter = vi.fn<(name: string) => void>();
  const exit = vi.fn<(name: string, signal: AbortSignal) => Promise<void> | undefined>();
  const cleanup = vi.fn<(name: string) => void>();
  const park = vi.fn<(name: string, connected: boolean) => void>();
  for (const [name, definition] of Object.entries({ layout, alpha, beta, outside })) {
    router.implement(definition, {
      untrackedKeys: [],
      async render() {
        if (name === 'outside' && prepareOutside) await prepareOutside();
        return () => {
          const html = document.createElement(name === 'alpha' && alphaTag ? alphaTag : 'section');
          html.dataset.page = name;
          pages.set(name, html);
          usePresenceScope()!.register(name === 'alpha' && alphaEntryOnly ? 'enter' : 'inout', ({ direction, signal }) => {
            if (direction === 'out') return exit(name, signal);
            enter(name);
          }, { park: () => park(name, html.isConnected) });
          onCleanup(() => cleanup(name));
          if (name === 'layout') {
            insert(html, () => createComponent(nestedMotion ? RetainingOutlet : Outlet, { component: 'article' }));
          }
          return { html, title: name };
        };
      },
    });
  }
  const host = document.createElement('div');
  document.body.append(host);
  const dispose = render(() => createComponent(rootMotion ? RetainingOutlet : Outlet, { component: 'main' }), host);
  const teardown = () => {
    router.dispose();
    dispose();
    host.remove();
  };
  try {
    await vi.waitFor(() => expect(router.currentLocator()?.route).toBe(alpha));
    flush();
    return { router, engine, pages, enter, exit, cleanup, park, host, teardown, alpha, beta, outside };
  } catch (error) {
    teardown();
    throw error;
  }
}

it('keeps staged pages dormant and enables motion only in the receiving outlet', async () => {
  const app = await presentationFixture({ nestedMotion: true });
  try {
    expect(app.enter.mock.calls).toEqual([['alpha']]);
    const root = app.host.querySelector('main')! as HTMLElement & Record<typeof outletDelegateAttribute, OutletDelegate>;
    const replaceLayout = vi.spyOn(root[outletDelegateAttribute], 'setElement');
    const target = app.beta.locate({});
    const lease = app.router.acquirePreparation(app.router.resolveDestination(target))!;
    try {
      await lease.ready;
      flush();
      const staged = app.pages.get('beta')!;
      expect(staged.closest('[data-kinetic-router-backstage]')).not.toBeNull();
      expect(app.enter.mock.calls).toEqual([['alpha']]);
      expect(app.exit).not.toHaveBeenCalled();
      await app.router.navigate(target).finished;
      flush();
      expect(app.enter.mock.calls).toEqual([['alpha'], ['beta']]);
      expect(app.exit.mock.calls.map(([name]) => name)).toEqual(['alpha']);
      expect(app.host.querySelector('[data-page=beta]')).toBe(staged);
      expect(replaceLayout).not.toHaveBeenCalled();
    } finally {
      lease.release();
    }
    await app.router.navigate(app.outside.locate({})).finished;
    flush();
    expect(app.enter.mock.calls).toEqual([['alpha'], ['beta']]);
    expect(app.exit.mock.calls.map(([name]) => name)).toEqual(['alpha']);
    expect(app.host.querySelector('[data-page=layout]')).toBeNull();
  } finally {
    app.teardown();
  }
});

it('reverses a cached instance during exit, ignores stale completion, and replays after parking', async () => {
  const app = await presentationFixture({ nestedMotion: true });
  try {
    const alpha = app.pages.get('alpha')!;
    const firstExit = Promise.withResolvers<void>();
    app.exit.mockReturnValueOnce(firstExit.promise);
    await app.router.navigate(app.beta.locate({})).finished;
    flush();
    const [name, signal] = app.exit.mock.calls[0];
    expect(name).toBe('alpha');
    expect(signal.aborted).toBe(false);
    expect(alpha.parentElement?.dataset.outgoing).toBe('');
    await app.engine.back().finished;
    flush();
    expect(signal.aborted).toBe(true);
    expect(app.host.querySelector('[data-page=alpha]')).toBe(alpha);
    expect(alpha.parentElement?.tagName).toBe('ARTICLE');
    expect(app.enter.mock.calls).toEqual([['alpha'], ['beta'], ['alpha']]);
    firstExit.resolve();
    await firstExit.promise;
    flush();
    expect(app.host.querySelector('[data-page=alpha]')).toBe(alpha);
    expect(app.host.querySelector('[data-outgoing]')).toBeNull();

    await app.engine.forward().finished;
    flush();
    expect(alpha.isConnected).toBe(false);
    await app.engine.back().finished;
    flush();
    expect(app.host.querySelector('[data-page=alpha]')).toBe(alpha);
    expect(app.enter.mock.calls).toEqual([['alpha'], ['beta'], ['alpha'], ['beta'], ['alpha']]);
  } finally {
    app.teardown();
  }
});

it('pins exiting ancestors and children past eviction and releases independent nested exits on departure', async () => {
  const app = await presentationFixture({ rootMotion: true, nestedMotion: true, maxCachedPages: 0 });
  try {
    const childExit = Promise.withResolvers<void>();
    const parentExit = Promise.withResolvers<void>();
    app.exit.mockImplementation(name => name === 'layout' ? parentExit.promise : childExit.promise);
    await app.router.navigate(app.beta.locate({}), { mode: 'replace' }).finished;
    flush();
    expect(app.exit.mock.calls.map(([name]) => name)).toEqual(['alpha']);
    expect(app.cleanup).not.toHaveBeenCalled();
    expect(app.host.querySelector('[data-outgoing] [data-page=alpha]')).not.toBeNull();

    await app.router.navigate(app.outside.locate({}), { mode: 'replace' }).finished;
    flush();
    expect(app.exit.mock.calls.map(([name]) => name)).toEqual(['alpha', 'layout']);
    expect(app.exit.mock.calls[0][1].aborted).toBe(true);
    expect(app.cleanup.mock.calls).toEqual([['alpha']]);
    expect(app.host.querySelectorAll('[data-outgoing]')).toHaveLength(1);
    expect(app.host.querySelector('[data-outgoing] [data-page=beta]')).not.toBeNull();
    expect(app.host.querySelector('main > [data-page=outside]')).not.toBeNull();

    parentExit.resolve();
    await parentExit.promise;
    flush();
    expect(app.cleanup.mock.calls).toEqual([['alpha'], ['beta'], ['layout']]);
    expect(app.host.querySelector('[data-outgoing]')).toBeNull();
  } finally {
    app.teardown();
  }
});

it('skips retention for an entry-only page in a motion outlet', async () => {
  const app = await presentationFixture({ nestedMotion: true, alphaEntryOnly: true });
  try {
    const alpha = app.pages.get('alpha')!;
    const appendOutgoing = vi.spyOn(app.host.querySelector('article')!, 'append');
    await app.router.navigate(app.beta.locate({})).finished;
    flush();
    expect(alpha.isConnected).toBe(false);
    expect(app.exit).not.toHaveBeenCalled();
    expect(appendOutgoing).not.toHaveBeenCalled();
    expect(app.enter.mock.calls).toEqual([['alpha'], ['beta']]);
  } finally {
    app.teardown();
  }
});

it('detaches a departing child before parking it when an exiting layout restores a different child', async () => {
  const app = await presentationFixture({ rootMotion: true });
  const pending = Promise.withResolvers<void>();
  try {
    const alphaEntryKey = app.engine.currentEntry().key;
    const layout = app.pages.get('layout')!;
    await app.router.navigate(app.beta.locate({})).finished;
    flush();
    app.exit.mockReturnValueOnce(pending.promise);
    await app.router.navigate(app.outside.locate({})).finished;
    flush();
    expect(layout.querySelector('[data-page=beta]')).toBe(app.pages.get('beta'));

    app.park.mockClear();
    await app.engine.traverseTo(alphaEntryKey).finished;
    flush();
    expect(app.host.querySelector('main')!.firstChild).toBe(layout);
    expect(layout.querySelector('[data-page=alpha]')).toBe(app.pages.get('alpha'));
    expect(app.park.mock.calls).toContainEqual(['beta', false]);
    expect(app.park.mock.calls).not.toContainEqual(['beta', true]);
  } finally {
    pending.resolve();
    app.teardown();
  }
});

it('restores the displayed page when retaining it starts a successor that waits and fails', async () => {
  const gate = Promise.withResolvers<void>();
  const failure = new Error('successor failed');
  let onDetach: (() => void) | undefined;
  const alphaTag = 'presentation-abort-alpha';
  customElements.define(alphaTag, class extends HTMLElement {
    disconnectedCallback() {
      const start = onDetach;
      onDetach = undefined;
      start?.();
    }
  });
  const prepareOutside = vi.fn(() => gate.promise);
  const app = await presentationFixture({ nestedMotion: true, alphaTag, prepareOutside });
  try {
    const slot = app.host.querySelector('article')!;
    const alpha = app.pages.get('alpha')!;
    let successor: Promise<unknown> | undefined;
    onDetach = () => {
      successor = app.router.navigate(app.outside.locate({})).finished;
    };

    await expect(app.router.navigate(app.beta.locate({})).finished).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(prepareOutside).toHaveBeenCalledOnce());
    expect(successor).toBeDefined();
    expect(slot.firstChild).toBe(alpha);
    expect(slot.childNodes).toHaveLength(1);
    expect(alpha.isConnected).toBe(true);
    expect(app.router.currentLocator()?.route).toBe(app.alpha);

    gate.reject(failure);
    await expect(successor).rejects.toThrow(failure);
    expect(slot.firstChild).toBe(alpha);
    expect(app.enter.mock.calls).toEqual([['alpha']]);
    expect(app.exit).not.toHaveBeenCalled();
  } finally {
    onDetach = undefined;
    gate.resolve();
    app.teardown();
  }
});

it('reattaches the displayed stack when a live outlet update is superseded by Back', async () => {
  const app = await presentationFixture({ rootMotion: true, nestedMotion: true });
  try {
    const layout = app.pages.get('layout')!;
    const root = app.host.querySelector('main')! as HTMLElement & Record<typeof outletDelegateAttribute, OutletDelegate>;
    const outlet = root[outletDelegateAttribute];
    const mount = outlet.setElement.bind(outlet);
    let back: Promise<unknown> | undefined;
    vi.spyOn(outlet, 'setElement').mockImplementation(element => {
      mount(element);
      if (element === app.pages.get('outside')) back = app.engine.back().finished;
    });

    await expect(app.router.navigate(app.outside.locate({})).finished).rejects.toMatchObject({ name: 'AbortError' });
    expect(back).toBeDefined();
    await back;
    flush();
    expect(root.firstChild).toBe(layout);
    expect(root.querySelector('[data-page=alpha]')).toBe(app.pages.get('alpha'));
    expect(root.querySelector('[data-outgoing]')).toBeNull();
    expect(app.enter.mock.calls).toEqual([['layout'], ['alpha']]);
    expect(app.exit).not.toHaveBeenCalled();
  } finally {
    app.teardown();
  }
});

it('parks an exiting instance when a live reentry is superseded', async () => {
  const app = await presentationFixture({ nestedMotion: true });
  try {
    const pending = Promise.withResolvers<void>();
    app.exit.mockReturnValueOnce(pending.promise);
    await app.router.navigate(app.beta.locate({})).finished;
    flush();
    const [name, signal] = app.exit.mock.calls[0];
    expect(name).toBe('alpha');
    expect(signal.aborted).toBe(false);

    const alpha = app.pages.get('alpha')!;
    const slot = app.host.querySelector('article')!;
    const layer = slot.querySelector('[data-outgoing]')!;
    const replace = layer.replaceWith.bind(layer);
    let forward: Promise<unknown> | undefined;
    const supersede = vi.spyOn(layer, 'replaceWith').mockImplementationOnce((...nodes) => {
      replace(...nodes);
      forward = app.engine.forward().finished;
    });
    await expect(app.engine.back().finished).rejects.toMatchObject({ name: 'AbortError' });
    expect(forward).toBeDefined();
    await forward;
    supersede.mockRestore();
    flush();
    expect(slot.firstChild).toBe(app.pages.get('beta'));
    expect(alpha.isConnected).toBe(false);
    expect(signal.aborted).toBe(true);

    await app.engine.back().finished;
    pending.resolve();
    await pending.promise;
    flush();
    expect(slot.firstChild).toBe(alpha);
    expect(slot.querySelector('[data-outgoing]')).toBeNull();
    expect(app.enter.mock.calls).toEqual([['alpha'], ['beta'], ['alpha']]);
  } finally {
    app.teardown();
  }
});

it('removes outgoing layers and cancels unsettled exits on router disposal', async () => {
  const app = await presentationFixture({ nestedMotion: true });
  try {
    const pending = Promise.withResolvers<void>();
    app.exit.mockReturnValueOnce(pending.promise);
    await app.router.navigate(app.beta.locate({})).finished;
    flush();
    const [, signal] = app.exit.mock.calls[0];
    expect(signal.aborted).toBe(false);
    expect(app.host.querySelector('[data-outgoing]')).not.toBeNull();

    app.router.dispose();
    expect(signal.aborted).toBe(true);
    expect(app.host.querySelector('[data-outgoing]')).toBeNull();
    expect(app.cleanup.mock.calls.map(([name]) => name).sort()).toEqual(['alpha', 'beta', 'layout']);
    pending.resolve();
    await pending.promise;
    flush();
    expect(app.cleanup).toHaveBeenCalledTimes(3);
  } finally {
    app.teardown();
  }
});
