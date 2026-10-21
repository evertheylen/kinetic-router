import { index, param, root, route } from '@kinetic-router/definition';
import { Router, type LinkMode, type Prefetch } from '@kinetic-router/solid/router.js';
import { Outlet } from '@kinetic-router/solid/outlet.js';
import { Link } from '@kinetic-router/solid/link.js';
import type { Page, PagePreparationContext } from '@kinetic-router/solid/page.js';
import { createSignal, flush, onCleanup } from 'solid-js';
import { render } from '@solidjs/web';

export type LinkFixture = ReturnType<typeof mountLinks>;

/** An isolated, inspectable browser fixture; it uses the production Link and
 * Navigation API, including the browser's real focus and pointer defaults. */
export function mountLinks(element: HTMLElement) {
  const query = new URL(location.href).searchParams;
  const home = route({}), a = route({}), detail = route({}), b = route({});
  const results = route({ q: param.search<string>().withDefault('all') });
  let nextDraft = 0;
  const draft = route({ token: param.hidden<number>().withDefault(() => ++nextDraft) });
  const draftTokens: (number | undefined)[] = [];
  let aliasTarget = a;
  const alias = route({}).aliasTo(() => aliasTarget.locate({}));
  const sitemap = root({ 'link-test': { home, a: { [index]: a, detail }, b, results, draft } });
  const router = new Router(sitemap, {
    prefetch: query.has('press') ? { hover: false, focus: false } : true,
    prefetchCache: { maxEntries: 0 },
    maxCachedPages: query.has('zero-cache') ? 0 : undefined,
  });
  const [target, setTarget] = createSignal(a.locate({}));
  const [mode, setMode] = createSignal<LinkMode>('push');
  const [prefetch, setPrefetch] = createSignal<Prefetch | undefined>();
  const [visible, setVisible] = createSignal(true);
  const gate = Promise.withResolvers<void>();
  const events: { type: string, entries: number }[] = [];
  const contexts: Record<string, PagePreparationContext[]> = { home: [], a: [], detail: [], b: [], draft: [] };
  const constructed = { home: 0, a: 0, detail: 0, b: 0 };
  const disposed = { home: 0, a: 0, detail: 0, b: 0 };
  const record = (event: Event) => events.push({ type: event.type, entries: window.navigation.entries().length });
  let imports = 0;
  for (const name of ['home', 'a', 'detail', 'b'] as const) {
    const page: Page<{}, {}, never> = {
      untrackedKeys: [],
      async render(_params, context) {
        contexts[name].push(context);
        onCleanup(() => disposed[name]++);
        if (name !== 'home' && query.has('hold')) await gate.promise;
        return () => {
          const instance = ++constructed[name];
          return { title: name, html: <section data-instance={instance}><h1>{name}</h1><label>Notes <input /></label></section> };
        };
      },
    };
    if (name === 'detail') router.implementLazy(detail, async () => { imports++; return page; }, { untrackedKeys: [] });
    else router.implement({ home, a, detail, b }[name], page);
  }
  router.implement(results, {
    untrackedKeys: [],
    async render() {
      return params => ({ title: 'results', html: <section><h1>Results</h1><output data-testid="default-query">{params.q}</output></section> });
    },
  });
  router.implement(draft, {
    untrackedKeys: ['token'],
    async render({ token }, context) {
      draftTokens.push(token);
      contexts.draft.push(context);
      if (query.has('hold')) await gate.promise;
      return () => ({ title: 'draft', html: <section><h1>Draft</h1><output data-testid="draft-token">{token}</output></section> });
    },
  });
  render(() => <>
    <nav aria-label="Managed links" style={{ display: 'flex', gap: '20px', padding: '20px' }}>
      {visible() && <Link data-testid="primary" route={target()} mode={mode()} prefetch={prefetch()}
        onPointerDown={record} onPointerUp={record} onLostPointerCapture={record} onClick={event => {
          record(event);
          if (query.has('unmount-on-click')) { setVisible(false); flush(); }
        }}>
        <span>First</span><span style={{ 'margin-left': '20px' }}>child</span>
      </Link>}
      <Link data-testid="second" route={a} prefetch={{ hover: 0 }}>Second</Link>
      <Link data-testid="bypass" route={a} prefetch={{ hover: 0, respectSaveData: false }}>Bypass</Link>
      <Link data-testid="prevented" route={a} onClick={event => { record(event); event.preventDefault(); }}>Prevented</Link>
      <Link data-testid="menu" route={a} mode="menu">Menu A</Link>
      <Link data-testid="detail" route={detail}>Detail</Link>
      <Link data-testid="replace" route={b} mode="replace">Replace B</Link>
      <Link data-testid="new-tab" route={a} target="_blank">New tab</Link>
      <Link data-testid="download" route={a} download>Download</Link>
      <a data-testid="plain" href={router.toUrl(b.locate({}))}>Plain B</a>
    </nav>
    <nav aria-label="Alias and default links">
      <Link data-testid="alias" route={alias} prefetch={{ hover: 0 }} onClick={() => { aliasTarget = b; }}>Changing alias</Link>
      <Link data-testid="default-managed" route={results}>Default query</Link>
      <Link data-testid="default-new-tab" route={results} target="_blank">Default query in new tab</Link>
      <a data-testid="default-plain" href={router.toUrl(results.locate({}))}>Plain default query</a>
      <a data-testid="draft-plain" href={router.toUrl(draft.locate({ token: 0 }))}>New draft</a>
    </nav>
    <button onClick={() => gate.resolve()}>Release renders</button>
    <button onClick={() => setVisible(false)}>Unmount primary</button>
    <Outlet component="main" />
  </>, element);
  const fixture = { router, routes: { home, a, detail, b, draft }, contexts, constructed, disposed, events, draftTokens,
    get imports() { return imports; }, get draftDefaults() { return nextDraft; },
    release: () => gate.resolve(), setTarget, setMode, setPrefetch };
  Object.assign(window, { linkFixture: fixture });
  return fixture;
}
