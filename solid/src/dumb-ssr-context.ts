import type { RootSitemap } from '@kinetic-router/definition/root.js';
import { createContext, omit } from 'solid-js';
import type { JSX } from '@solidjs/web';

/** @internal Request-local routing only; never a browser Router. */
export const DumbSsrContext = createContext<{
  sitemap: RootSitemap,
  renderOutlet: () => JSX.Element,
} | null>(null);

/** @internal Server markup must not invoke DOM refs or install handlers. */
export function withoutClientHandlers<T extends object>(props: T): T {
  return omit(props, ...Object.keys(props).filter(key => key === 'ref' || /^on/i.test(key)) as (keyof T)[]) as T;
}
