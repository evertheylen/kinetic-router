import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { index, param, root, route } from '@kinetic-router/definition';
import { createComponent, createMemo, createRoot, Errored, Loading, onCleanup, Show } from 'solid-js';
import { Dynamic, isDev, isServer } from '@solidjs/web';
import { DumbSsrUrlError, renderDumbSsr } from './dumb-ssr.js';
import { SolidImplementationMap } from './implementation-map.js';
import { Link } from './link.js';
import { Outlet, rootOutletId } from './outlet.js';
import type { PagePreparationContext } from './page.js';

const url = (path = '/go/') => new URL(path, 'https://public.example');
const element = (component: string, children?: unknown) => createComponent(Dynamic, { component, children });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
beforeEach(() => vi.stubGlobal('navigator', undefined)); // Node also supplies a navigator.
afterEach(() => vi.unstubAllGlobals());

function fixture() {
  const home = route({});
  const sitemap = root({ go: { [index]: home } });
  const pages = new SolidImplementationMap(sitemap);
  const cleanup = vi.fn();
  const output = vi.fn(() => ({ html: element('h1', 'Public <&>'), title: 'Public <&>' }));
  let context!: PagePreparationContext;
  const factory = vi.fn(async (_: {}, ctx: PagePreparationContext) => {
    context = ctx;
    onCleanup(cleanup);
    return output;
  });
  pages.implement(home, { untrackedKeys: [], render: factory });
  return { sitemap, pages, cleanup, output, factory, context: () => context };
}

it('runs with server Solid and no browser globals, escapes HTML, emits no scripts and cleans up', async () => {
  expect(isServer).toBe(true);
  expect(isDev).toBe(process.env.NODE_ENV !== 'production');
  expect(typeof window).toBe('undefined');
  expect(typeof document).toBe('undefined');
  expect(typeof navigator).toBe('undefined');
  const f = fixture();
  const result = await renderDumbSsr({ ...f, url: url() });
  expect(result).toEqual({ html: '<h1>Public &lt;&amp;></h1>', title: 'Public <&>' });
  expect(f.factory).toHaveBeenCalledOnce();
  expect(f.output).toHaveBeenCalledOnce();
  expect(f.cleanup).toHaveBeenCalledOnce();
  expect(f.context().signal.aborted).toBe(true);
  expect(f.context().pageStatus.shouldFetch()).toBe(false);
});

it('reads HTML/metadata getters once while output is live, before cleanup', async () => {
  const f = fixture();
  const html = vi.fn(() => element('p', 'one getter read'));
  const title = vi.fn(() => {
    expect(f.cleanup).not.toHaveBeenCalled();
    return 'live title';
  });
  f.output.mockImplementation(() => ({ get html() { return html(); }, get title() { return title(); } }));
  expect(await renderDumbSsr({ ...f, url: url() })).toEqual({ html: '<p>one getter read</p>', title: 'live title' });
  expect(html).toHaveBeenCalledOnce();
  expect(title).toHaveBeenCalledOnce();
  expect(f.cleanup).toHaveBeenCalledOnce();
});

it('composes lazy nested pages, app/leaf outlets, live metadata, aliases and parameter identity/defaults', async () => {
  const id = param.path<string>();
  const shared = param.search<string>().withDefault('all');
  const token = param.hidden<string>().withDefault('public');
  const privateValue = param.hidden<string>();
  const layout = route({ shared, token });
  const leaf = layout.nestedRoute({ id, renamed: shared, privateValue });
  const alias = route({ id }).aliasTo(({ id }) => leaf.locate({ id, privateValue: undefined! }));
  const shortcut = route({}).aliasTo(() => leaf.locate({ id: 'shortcut', privateValue: undefined! }));
  const sitemap = root({ go: { item: { [id.$]: leaf }, old: { [id.$]: alias }, shortcut } });
  const pages = new SolidImplementationMap<{}, { description: string }>(sitemap);
  const contexts: PagePreparationContext[] = [];
  const refs = vi.fn();
  const cleanup = vi.fn();
  pages.implement(layout, {
    untrackedKeys: ['shared', 'token'],
    async render(inputs, context) {
      expect(inputs).toEqual({ shared: 'all', token: 'public' });
      contexts.push(context);
      onCleanup(cleanup);
      return reactive => {
        expect(reactive).toEqual({});
        return { html: element('section', () => createComponent(Outlet, { component: 'article', class: 'child', ref: refs })),
          title: 'layout', description: 'layout' };
      };
    },
  });
  const untrackedKeys = ['shared', 'renamed', 'token'] as const;
  const load = vi.fn(async () => ({
    untrackedKeys,
    async render(inputs: object, context: PagePreparationContext) {
      expect(inputs).toEqual({ shared: 'all', renamed: 'all', token: 'public' });
      expect(Object.isFrozen(inputs)).toBe(true);
      contexts.push(context);
      onCleanup(cleanup);
      const { pageStatus: status } = context;
      expect([status.shouldFetch(), status.isVisible(), status.hasFocus(), status.isAnimating()]).toEqual([true, false, false, false]);
      expect(status.fetchSignal()).toBe(context.signal);
      await tick();
      return (reactive: object) => {
        expect(reactive).toEqual({ id: 'hello' });
        expect(Object.isFrozen(reactive)).toBe(true);
        const data = createMemo(async () => { await tick(); return 'loaded'; });
        return {
          html: element('div', [
            () => data(),
            () => createComponent(Link, { route: alias.locate({ id: 'next' }), mode: 'menu' as const, prefetch: { hover: -1 },
              class: 'native', 'aria-label': 'Next', title: 'A " & <', children: '<Next>', ref: refs, onClick: refs }),
            () => createComponent(Link, { route: shortcut, children: 'Shortcut' }),
            () => createComponent(Outlet, { component: 'aside' }),
          ]),
          get title() { return `Leaf ${data()}`; },
          get description() { return `Description ${data()}`; },
        };
      };
    },
  }));
  pages.implementLazy(leaf, load, { untrackedKeys });
  const result = await renderDumbSsr({ sitemap, pages, url: url('/go/old/hello'),
    app: () => element('main', () => createComponent(Outlet, { component: 'div', class: 'root', ref: refs })),
  });
  expect(result.title).toBe('Leaf loaded');
  expect(result.description).toBe('Description loaded');
  expect(result.html).toContain('<main><div class="root"><section><article class="child"><div>loaded');
  expect(result.html).toContain('href="/go/item/next"');
  expect(result.html).toContain('class="native"');
  expect(result.html).toContain('aria-label="Next"');
  expect(result.html).toContain('title="A &quot; &amp; &lt;"');
  expect(result.html).toContain('href="/go/item/shortcut"');
  expect(result.html).toContain('&lt;Next>');
  expect(result.html).toContain('<aside></aside>');
  expect(result.html).not.toMatch(/script|prefetch|mode=|route=|onclick|data-hk| ref=|__kinetic/);
  expect(result.html).not.toContain(rootOutletId);
  expect(load).toHaveBeenCalledOnce();
  expect(refs).not.toHaveBeenCalled();
  expect(cleanup).toHaveBeenCalledTimes(2);
  expect(contexts.every(context => context.signal.aborted)).toBe(true);
});

it('rejects missing registrations, unmatched/invalid URLs and absent required URL values before factories', async () => {
  const f = fixture();
  await expect(renderDumbSsr({ ...f, url: url('/missing') })).rejects.toBeInstanceOf(DumbSsrUrlError);
  expect(f.factory).not.toHaveBeenCalled();
  const required = route({ q: param.search<string>(), hidden: param.hidden<string>() });
  const sitemap = root({ required });
  const pages = new SolidImplementationMap(sitemap);
  await expect(renderDumbSsr({ sitemap, pages, url: url('/required') })).rejects.toThrow('No implementation');
  pages.implement(required, { untrackedKeys: [], render: f.factory });
  await expect(renderDumbSsr({ sitemap, pages, url: url('/required') })).rejects.toBeInstanceOf(DumbSsrUrlError);
  expect(f.factory).not.toHaveBeenCalled();
  await renderDumbSsr({ sitemap, pages, url: url('/required?q=ok') });
  expect(f.factory).toHaveBeenCalledOnce();
});

it('allows absent optional URL inputs and preserves URL error causes', async () => {
  const optional = route({ q: param.search<string>().optional(), hidden: param.hidden<string>() });
  const sitemap = root({ optional });
  const pages = new SolidImplementationMap(sitemap);
  pages.implement(optional, { untrackedKeys: [], async render() {
    return inputs => {
      expect(inputs).toEqual({});
      expect(inputs.q).toBeUndefined();
      expect(inputs.hidden).toBeUndefined();
      return { html: 'public fallback', title: 'fallback' };
    };
  } });
  expect((await renderDumbSsr({ sitemap, pages, url: url('/optional') })).html).toBe('public fallback');
  const failure = new Error('bad serde');
  const value = param.search<string>({ serialize: x => x, deserialize: () => { throw failure; } });
  const invalid = route({ value });
  const invalidSitemap = root({ invalid });
  const invalidPages = new SolidImplementationMap(invalidSitemap);
  invalidPages.implement(invalid, { untrackedKeys: [], render: fixture().factory });
  await expect(renderDumbSsr({ sitemap: invalidSitemap, pages: invalidPages, url: url('/invalid?value=x') })).rejects.toMatchObject({ cause: failure });
});

it('rejects a layout/app that silently omits its required Outlet', async () => {
  const f = fixture();
  await expect(renderDumbSsr({ ...f, url: url(), app: () => element('main', 'No outlet') })).rejects.toThrow('Outlet');
  const layout = route({}), leaf = layout.nestedRoute({});
  const sitemap = root({ go: { [index]: leaf } });
  const pages = new SolidImplementationMap(sitemap);
  pages.implement(layout, { untrackedKeys: [], render: f.factory });
  pages.implement(leaf, { untrackedKeys: [], render: f.factory });
  await expect(renderDumbSsr({ sitemap, pages, url: url() })).rejects.toThrow('Outlet');
  expect(f.cleanup).toHaveBeenCalledOnce();
});

it('rejects competing outlets, but not lazy rereads of one Outlet', async () => {
  const f = fixture();
  await expect(renderDumbSsr({ ...f, url: url(), app: () => element('div', [
    () => createComponent(Outlet, { component: 'main' }),
    () => createComponent(Outlet, { component: 'aside' }),
  ]) })).rejects.toThrow('Multiple Outlets');
  const g = fixture();
  const Reread = (props: { children?: unknown }) => { void props.children; return element('main', props.children); };
  const result = await renderDumbSsr({ ...g, url: url(), app: () => createComponent(Outlet, { component: Reread }) });
  expect(result.html).toContain('<h1>');
  expect(g.factory).toHaveBeenCalledOnce();
});

it('supports conditional outlets and replaces disposed error-boundary attempts without false duplicates', async () => {
  const f = fixture();
  const result = await renderDumbSsr({ ...f, url: url(), app: () => {
    const ready = createMemo(async () => { await tick(); return true; });
    return createComponent(Show, {
      get when() { return ready(); },
      children: (_value: unknown) => createComponent(Outlet, { component: 'main' }),
    });
  } });
  expect(result.html).toContain('<h1>');
  expect(f.factory).toHaveBeenCalledOnce();
  const g = fixture();
  const recovered = await renderDumbSsr({ ...g, url: url(), app: () => createComponent(Errored, {
    fallback: () => createComponent(Outlet, { component: 'main' }),
    get children(): never {
      createComponent(Outlet, { component: 'aside' });
      throw new Error('Intentional app fallback');
    },
  }) });
  expect(recovered.html).toContain('<main><h1>');
  expect(recovered.html).not.toContain('<aside>');
  expect(recovered.html.match(/<h1>/g)).toHaveLength(1);
  expect(g.cleanup.mock.calls.length).toBe(g.factory.mock.calls.length);
});

it.each([false, true])('validates the final stack after an error boundary discards already-rendered output (replacement=%s)', async replacement => {
  const f = fixture();
  const entered = Promise.withResolvers<void>();
  let attempts = 0;
  f.output.mockImplementation(() => {
    const attempt = ++attempts;
    entered.resolve();
    return { html: element('h1', `attempt ${attempt}`), title: `attempt ${attempt}` };
  });
  const result = renderDumbSsr({ ...f, url: url(), app: () => {
    const failure = createMemo(async () => {
      await entered.promise;
      await tick(); // Let the first page actually contribute HTML before failing.
      throw new Error('Discard the first stack');
    });
    return createComponent(Errored, {
      fallback: () => replacement ? createComponent(Outlet, { component: 'main' }) : element('p', 'No matched page'),
      get children() { return element('div', [
        () => createComponent(Outlet, { component: 'aside' }), () => failure(),
      ]); },
    });
  } });
  if (replacement) {
    const output = await result;
    expect(output.title).toBe(`attempt ${attempts}`);
    expect(output.html).toContain(`<main><h1>attempt ${attempts}</h1></main>`);
    expect(output.html).not.toContain('kinetic-ssr-');
    expect(attempts).toBeGreaterThan(1);
  } else await expect(result).rejects.toThrow('Outlet');
  expect(f.cleanup.mock.calls.length).toBe(f.factory.mock.calls.length);
});

it('disposes app-owned cleanup on first-pass synchronous failure', async () => {
  const f = fixture();
  const cleanup = vi.fn();
  await expect(renderDumbSsr({ ...f, url: url(), app: () => {
    onCleanup(cleanup);
    throw new Error('synchronous');
  } })).rejects.toThrow('synchronous');
  expect(cleanup).toHaveBeenCalledOnce();
});

it('rejects an async Loading failure because no hydrating client can recover it', async () => {
  const f = fixture();
  f.output.mockImplementation(() => {
    const data = createMemo(async () => { await tick(); throw new Error('Loading failed'); });
    return { title: 'bad', html: createComponent(Loading, {
      fallback: 'loading',
      get children() { return element('p', () => data()); },
    }) };
  });
  await expect(renderDumbSsr({ ...f, url: url() })).rejects.toThrow('Loading failed');
  expect(f.cleanup).toHaveBeenCalledOnce();
});

it.each(['factory', 'output', 'async child', 'app'] as const)('rejects genuine %s failures instead of successful blank HTML', async stage => {
  const f = fixture();
  const failure = new Error(stage);
  if (stage === 'factory') f.factory.mockImplementation(async () => { onCleanup(f.cleanup); throw failure; });
  if (stage === 'output') f.output.mockImplementation(() => { throw failure; });
  if (stage === 'async child') f.output.mockImplementation(() => {
    const value = createMemo(async () => { await tick(); throw failure; });
    return { title: 'bad', html: element('p', () => value()) };
  });
  await expect(renderDumbSsr({ ...f, url: url(), app: stage === 'app' ? () => { throw failure; } : undefined })).rejects.toBe(failure);
  expect(f.cleanup).toHaveBeenCalledTimes(stage === 'app' ? 0 : 1);
  if (stage !== 'app') expect(f.context()?.signal.aborted ?? true).toBe(true);
});

it('does not execute already-cancelled requests', async () => {
  const f = fixture();
  const signal = AbortSignal.abort(new Error('cancelled'));
  await expect(renderDumbSsr({ ...f, url: url(), signal })).rejects.toBe(signal.reason);
  expect(f.factory).not.toHaveBeenCalled();
});

it.each(['factory', 'loader', 'child'] as const)('settles abort of uncooperative %s work, disposes once and ignores late completion', async stage => {
  const f = fixture();
  const gate = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  const output = f.output;
  if (stage === 'factory') f.factory.mockImplementation(async (_params, context) => {
    onCleanup(f.cleanup);
    expect(context.pageStatus.shouldFetch()).toBe(true);
    started.resolve();
    await gate.promise;
    return output;
  });
  if (stage === 'loader') {
    f.pages = new SolidImplementationMap(f.sitemap);
    f.pages.implementLazy(f.sitemap.go[index], async () => {
      started.resolve();
      await gate.promise;
      return { untrackedKeys: [], render: f.factory };
    }, { untrackedKeys: [] });
  }
  if (stage === 'child') output.mockImplementation(() => {
    const value = createMemo(async () => { started.resolve(); await gate.promise; return 'late'; });
    return { html: element('p', () => value()), title: 'pending' };
  });
  const controller = new AbortController();
  const result = renderDumbSsr({ ...f, url: url(), signal: controller.signal });
  await started.promise;
  controller.abort(new Error('caller cancelled'));
  await expect(result).rejects.toBe(controller.signal.reason);
  expect(f.cleanup).toHaveBeenCalledTimes(stage === 'loader' ? 0 : 1);
  const calls = output.mock.calls.length;
  gate.resolve();
  await tick();
  expect(output).toHaveBeenCalledTimes(calls);
  if (stage === 'loader') expect(f.factory).not.toHaveBeenCalled();
  expect(f.cleanup).toHaveBeenCalledTimes(stage === 'loader' ? 0 : 1);
});

it('removes caller listeners and aborts owned fetching without aborting the caller on success/failure', async () => {
  for (const fail of [false, true]) {
    const f = fixture();
    if (fail) f.output.mockImplementation(() => { throw new Error('failed output'); });
    const caller = new AbortController();
    const add = vi.spyOn(caller.signal, 'addEventListener');
    const remove = vi.spyOn(caller.signal, 'removeEventListener');
    const result = renderDumbSsr({ ...f, url: url(), signal: caller.signal });
    if (fail) await expect(result).rejects.toThrow('failed output');
    else await result;
    expect(add).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0][1]);
    expect(caller.signal.aborted).toBe(false);
    expect(f.context().signal.aborted).toBe(true);
  }
});

it('settles synchronous cancellation before stream creation returns, including a simultaneous throw', async () => {
  const f = fixture();
  const caller = new AbortController();
  const reason = new Error('sync cancellation');
  const cleanup = vi.fn();
  const result = renderDumbSsr({ ...f, url: url(), signal: caller.signal, app: () => {
    onCleanup(cleanup);
    caller.abort(reason);
    throw new Error('render failed too');
  } });
  await expect(result).rejects.toBe(reason);
  expect(cleanup).toHaveBeenCalledOnce();
  expect(f.factory).not.toHaveBeenCalled();
});

it('observes late factory rejections after cancellation and never registers a global server Router', async () => {
  const f = fixture();
  const gate = Promise.withResolvers<void>();
  f.factory.mockImplementation(async () => {
    onCleanup(f.cleanup);
    await gate.promise;
    return f.output;
  });
  const caller = new AbortController();
  const result = renderDumbSsr({ ...f, url: url(), signal: caller.signal });
  await tick();
  caller.abort();
  await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  gate.reject(new Error('late rejection'));
  await tick(); // Vitest also fails on an unhandled rejection.
  expect(f.cleanup).toHaveBeenCalledOnce();
  expect(f.output).not.toHaveBeenCalled();
  expect(() => createRoot(() => createComponent(Link, { route: f.sitemap.go[index] }))).toThrow('Create a Router');
});

it('interleaves independent successful, failed and cancelled requests using shared registrations', async () => {
  const name = param.search<string>();
  const home = route({ name });
  const sitemap = root({ go: { [index]: home } });
  const pages = new SolidImplementationMap<{}, { description: string }>(sitemap);
  const gates = Array.from({ length: 3 }, () => Promise.withResolvers<void>());
  const contexts: PagePreparationContext[] = [];
  const cleaned: number[] = [];
  pages.implement(home, { untrackedKeys: ['name'], async render({ name }, context) {
    const index = Number(name);
    contexts[index] = context;
    onCleanup(() => cleaned.push(index));
    await gates[index].promise;
    if (index === 1) throw new Error('failed request');
    return () => ({ html: element('p', [name, () => createComponent(Link, { route: home.locate({ name }), children: name })]),
      title: name, description: name });
  } });
  const controller = new AbortController();
  const requests = [0, 1, 2].map(index => renderDumbSsr({ sitemap, pages, url: url(`/go/?name=${index}`), signal: index === 2 ? controller.signal : undefined }));
  await tick();
  controller.abort();
  await expect(requests[2]).rejects.toMatchObject({ name: 'AbortError' });
  gates[1].resolve();
  await expect(requests[1]).rejects.toThrow('failed request');
  gates[0].resolve();
  expect(await requests[0]).toMatchObject({ title: '0', description: '0' });
  expect((await requests[0]).html).toContain('href="/go?name=0"');
  gates[2].resolve();
  await tick();
  expect(cleaned.sort()).toEqual([0, 1, 2]);
  expect(contexts.every(context => context.signal.aborted)).toBe(true);
});
