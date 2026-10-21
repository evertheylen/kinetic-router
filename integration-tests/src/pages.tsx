import { render } from '@solidjs/web';
import type { Route } from '@kinetic-router/definition';
import { Router, type NavigationMode } from '@kinetic-router/solid/router.js';
import { Frame } from '@kinetic-router/solid/frame.js';
import type { Scenario, TestPage } from './scenario.js';
import { Fingerprint } from '@kinetic-router/testing-utils/fingerprint.js';

// One scenario per document: changing scenarios opens a fresh tab/history stack.
let router: Router;
let pendingNavigations = 0;
type Link = { to: Route<{}>, mode?: NavigationMode };

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
              {Object.entries(links).map(([label, { to, mode }]) => mode
                ? <button onClick={async () => {
                  pendingNavigations++;
                  try { await router.navigate(to.locate({}), { mode }).finished; }
                  finally { pendingNavigations--; }
                }}>{label}</button>
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
    page: { ...page, async render(params, context) {
      await ready;
      return page.render(params, context);
    } } satisfies TestPage,
  };
}

export function mount(setup: Awaited<ReturnType<Scenario['setup']>>, element: HTMLElement) {
  async function traverse(direction: 'back' | 'forward') {
    // Traversal is queued before navigation.transition becomes available.
    pendingNavigations++;
    try { await window.navigation[direction]().finished; }
    finally { pendingNavigations--; }
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
  return () => router.currentLocator() !== undefined && pendingNavigations === 0 && !window.navigation.transition;
}
