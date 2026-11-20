import { HiddenParamDef, convertParamsByDefinition, convertParamsByKey, type AnyParamDefs } from '@kinetic-router/definition/params.js';
import type { RootSitemap } from '@kinetic-router/definition/root.js';
import { renderToStream, ssr, type JSX } from '@solidjs/web';
import { createComponent, createMemo, createRoot, getOwner, NoHydration, onCleanup, runWithOwner } from 'solid-js';
import { DumbSsrContext } from './dumb-ssr-context.js';
import type { SolidImplementationMap } from './implementation-map.js';
import type { PageStatus } from './page.js';
import { createRouteUrls } from './route-urls.js';

/** Matching/deserialization or missing required URL inputs, before page execution.
 * Adapters may distinguish this from implementation/render failures; HTTP status,
 * redirects and error documents remain the adapter's responsibility. */
export class DumbSsrUrlError extends Error {
  override name = 'DumbSsrUrlError';
}

export type DumbSsrOptions<ExtraStaticData extends object = {}, ExtraOutput extends object = {}> = {
  sitemap: RootSitemap,
  pages: SolidImplementationMap<ExtraStaticData, ExtraOutput>,
  url: URL,
  /** Use the same path as the browser Router's `basePath` for matching and Links. */
  basePath?: string,
  /** Optional app shell containing a root Outlet. Omit to render the page stack. */
  app?: () => JSX.Element,
  signal?: AbortSignal,
};

/** One-shot public HTML, NOT hydration or a NavigationEngine. Use server-conditioned
 * Solid and SSR-compiled components; do not construct a Router or import browser
 * startup here. Hidden inputs have only defaults/absent values, never history or
 * personal storage. The caller is responsible for public-data/access policy.
 *
 * Factories and output run in request-owned Solid scopes. PageStatus permits
 * fetching for this render only; visibility, focus and animation are always false.
 * Cleanup aborts render-owned signals on success, failure and caller cancellation.
 * Uncooperative application promises cannot delay cancellation or revive output.
 *
 * Returns complete app markup and the leaf's title/ExtraOutput (not its closure or
 * data). No hydration/bootstrap scripts are emitted. Escape metadata when building
 * the HTTP document. Browsers must render fresh DOM, replacing the app root's old
 * children with Solid render's third argument; see ../docs/dumb-ssr.md. */
export async function renderDumbSsr<ExtraStaticData extends object, ExtraOutput extends object>({
  sitemap, pages, url, basePath, app, signal,
}: DumbSsrOptions<ExtraStaticData, ExtraOutput>): Promise<{ html: string, title: string } & ExtraOutput> {
  signal?.throwIfAborted();
  pages.check();
  const { toLocator, toUrl } = createRouteUrls(sitemap, basePath);
  let locator;
  try {
    locator = toLocator(url);
    for (const [key, definition] of Object.entries(locator.route.paramDefs as AnyParamDefs)) {
      if (!(definition instanceof HiddenParamDef) && !definition.makeDefault && locator.values[key] === undefined) {
        throw new Error(`Missing required URL parameter: ${key}`);
      }
    }
  } catch (cause) {
    throw new DumbSsrUrlError('Invalid or unmatched SSR URL', { cause });
  }
  const values = convertParamsByDefinition(locator.values, locator.route.paramDefs);
  const routes = [...locator.route.nestedInRoutes, locator.route];
  const controller = new AbortController();
  type Output = { html: JSX.Element, title: string } & ExtraOutput;
  const metadata = new Map<number, Output>();
  let instanceCount = 0;
  // Solid error boundaries can retain abandoned scopes. Private comments let us
  // validate the stack that actually reached the completed HTML, not those scopes.
  // They contain no app data and are removed before returning markup to the host.
  const marker = `kinetic-ssr-${crypto.randomUUID()}`;

  const renderPage = (index: number): JSX.Element => {
    if (index === routes.length) return undefined;
    const route = routes[index];
    return createComponent(DumbSsrContext, {
      value: { toUrl, renderOutlet: () => renderPage(index + 1) },
      get children() {
        controller.signal.throwIfAborted();
        const instance = instanceCount++;
        const lifetime = new AbortController();
        const pageSignal = AbortSignal.any([controller.signal, lifetime.signal]);
        const status: PageStatus = {
          shouldFetch: () => !pageSignal.aborted,
          fetchSignal: () => pageSignal.aborted ? undefined : pageSignal,
          isVisible: () => false,
          hasFocus: () => false,
          isAnimating: () => false,
        };
        onCleanup(() => lifetime.abort());
        const owner = getOwner()!;
        const untrackedKeys = pages.getStaticPartOfImplementation(route).untrackedKeys;
        const untracked: Record<string, unknown> = {}, reactive: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(convertParamsByKey(values, route.paramDefs))) {
          (untrackedKeys.includes(key) ? untracked : reactive)[key] = value;
        }
        Object.freeze(untracked);
        Object.freeze(reactive);
        const prepared = createMemo(async () => {
          const implementation = await pages.loadImplementation(route);
          pageSignal.throwIfAborted();
          const factory = await runWithOwner(owner, () => implementation.render(untracked, {
            signal: pageSignal, pageStatus: status,
          }));
          pageSignal.throwIfAborted();
          return factory;
        });
        const output = createMemo(() => {
          const factory = prepared();
          pageSignal.throwIfAborted();
          return factory(reactive, status);
        });
        // SAFETY: Solid accepts lazy child thunks at runtime, including on the
        // server; JSX.Element's DOM-oriented type omits that representation.
        return (() => {
          let result = output();
          if (index === routes.length - 1) {
            result = { ...result }; // Snapshot getters once while their scope is live.
            metadata.set(instance, result);
          }
          return [ssr(`<!--${marker}:${index}:${instance}-->`), result.html];
        }) as unknown as JSX.Element;
      },
    });
  };

  let cancel = () => {};
  let dispose = () => {};
  try {
    // Solid owns async scheduling/disposal. Normalize its non-rejecting stream
    // errors and cancellation (which can otherwise leave awaiting it pending).
    const html = await new Promise<string>((resolve, reject) => {
      cancel = () => {
        reject(signal!.reason);
        controller.abort(signal!.reason);
      };
      signal?.addEventListener('abort', cancel, { once: true });
      signal?.throwIfAborted();
      createRoot(disposeRoot => {
        dispose = disposeRoot;
        const stream = renderToStream(() => createComponent(NoHydration, {
          get children() {
            return createComponent(DumbSsrContext, {
              value: { toUrl, renderOutlet: () => renderPage(0) },
              get children() { return app ? app() : renderPage(0); },
            });
          },
        }), {
          noScripts: true,
          signal: controller.signal,
          onError(error, context) {
            if (context.handling !== 'fallback') reject(error);
          },
        });
        Promise.resolve(stream).then(resolve, reject);
      });
    });
    const rendered = new Set<number>();
    let leaf: Output | undefined;
    const markup = html.replace(new RegExp(`<!--${marker}:(\\d+):(\\d+)-->`, 'g'), (_match, routeIndex, instance) => {
      const index = Number(routeIndex);
      if (rendered.has(index)) throw new Error('Multiple Outlets render the same matched child page');
      rendered.add(index);
      if (index === routes.length - 1) leaf = metadata.get(Number(instance));
      return '';
    });
    if (rendered.size !== routes.length || !leaf) {
      throw new Error('Dumb SSR requires an Outlet for every matched child page');
    }
    return { ...leaf, html: markup };
  } finally {
    signal?.removeEventListener('abort', cancel);
    controller.abort();
    dispose();
  }
}
