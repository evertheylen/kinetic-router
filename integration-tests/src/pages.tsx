import { render } from '@solidjs/web';
import type { Route } from '@kinetic-router/definition';
import { Router } from '@kinetic-router/solid/router.js';
import { Frame } from '@kinetic-router/solid/frame.js';
import type { Scenario, TestPage } from './scenario.js';
import { Fingerprint } from './fingerprint.js';

// One scenario per document: changing scenarios opens a fresh tab/history stack.
let router: Router;
type Link = { to: Route<{}>, replace?: boolean };

export function simplePage(title: string, links: Record<string, Link> = {}): TestPage {
  return {
    untrackedKeys: [],
    async render() {
      return () => ({
        title,
        html: (
          <section>
            <h1>{title}</h1>
            <Fingerprint />
            <label>Notes <input /></label>
            <nav aria-label="Page links">
              {Object.entries(links).map(([label, { to, replace }]) => replace
                ? <button onClick={() => router.navigate(to.locate({}), { replace: true })}>{label}</button>
                : <a href={router.toUrl(to.locate({}))}>{label}</a>)}
            </nav>
          </section>
        ),
      });
    },
  };
}

export function delayedPage(title: string) {
  let finish!: () => void;
  const ready = new Promise<void>(resolve => { finish = resolve; });
  const page = simplePage(title);
  return {
    finish,
    page: { ...page, async render(params) {
      await ready;
      return page.render(params);
    } } satisfies TestPage,
  };
}

export function mount(setup: Awaited<ReturnType<Scenario['setup']>>, element: HTMLElement) {
  let pendingTraversals = 0;
  async function traverse(direction: 'back' | 'forward') {
    // Traversal is queued before navigation.transition becomes available.
    pendingTraversals++;
    try { await window.navigation[direction]().finished; }
    finally { pendingTraversals--; }
  }
  router = new Router(setup.sitemap); // real NavigationApiEngine and Solid Frame
  for (const [route, implementation] of setup.pages) router.implement(route, implementation);
  render(() => <>
    <nav aria-label="History">
      <button onClick={() => traverse('back')}>Back</button>
      <button onClick={() => traverse('forward')}>Forward</button>
      {setup.controls?.map(control => <button onClick={() => control.run()}>{control.label}</button>)}
    </nav>
    <Frame component="main" />
  </>, element);
  return () => router.currentLocator() !== undefined && pendingTraversals === 0 && !window.navigation.transition;
}
