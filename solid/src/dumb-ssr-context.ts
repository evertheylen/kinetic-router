import type { Locator } from '@kinetic-router/definition/routes.js';
import { createContext, omit } from 'solid-js';
import type { JSX } from '@solidjs/web';

/** @internal Request-local routing only; never a browser Router. */
export const DumbSsrContext = createContext<{
  toUrl(locator: Locator<any>): string,
  renderOutlet: () => JSX.Element,
} | null>(null);

/** @internal Server markup must not invoke DOM refs or install handlers. */
export function withoutClientHandlers<T extends object>(props: T): T {
  return omit(props, ...Object.keys(props).filter(key => key === 'ref' || /^on/i.test(key)) as (keyof T)[]) as T;
}
