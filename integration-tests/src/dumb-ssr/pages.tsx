import { route, root } from '@kinetic-router/definition';
import { Link } from '@kinetic-router/solid/link.js';
import { Outlet } from '@kinetic-router/solid/outlet.js';
import type { Router } from '@kinetic-router/solid/router.js';
import type { SolidImplementationMap } from '@kinetic-router/solid/implementation-map.js';
import type { PagePreparationContext } from '@kinetic-router/solid/page.js';
import { onCleanup } from 'solid-js';

export const home = route({}), next = route({});
export const basePath = '/go';
export const sitemap = root({ home, next });
export type Metadata = { description: string };

// The same registration function works with a browser Router or server map.
// Imports here must not initialize browser storage, analytics or a Router.
export function registerPages(pages: Pick<SolidImplementationMap<{}, Metadata>, 'implement' | 'implementLazy'>, options: {
  load: (name: string, context: PagePreparationContext) => Promise<string>,
  disposed?: () => void,
}) {
  for (const [name, definition] of Object.entries({ home, next })) {
    pages.implement(definition, {
      untrackedKeys: [],
      async render(_params, context) {
        onCleanup(() => options.disposed?.());
        const heading = await options.load(name, context);
        return () => ({
          html: <article><h1>{heading}</h1><p>A useful, URL-specific public summary for {name}.</p></article>,
          title: `${heading} <&>`,
          description: `Public description of ${name} <&>`,
        });
      },
    });
  }
}

export function App(props: { router?: Router<{}, Metadata> }) {
  return <main data-render={props.router ? 'client' : 'server'}>
    <nav><Link route={home}>Home</Link> <Link route={next}>Next</Link></nav>
    <label>Notes <input disabled={!props.router} placeholder="Public summary is not editable" /></label>
    {props.router && <p role="status">{props.router!.currentLocator() ? 'Ready' : 'Loading client content…'}</p>}
    <Outlet component="div" class="pages" />
  </main>;
}
