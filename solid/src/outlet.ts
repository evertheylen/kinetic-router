
import { Dynamic, isServer } from "@solidjs/web";
import { InRenderedRoute } from "./rendered-route.js";
import { createComponent, merge, omit, useContext } from "solid-js";
import { DumbSsrContext, withoutClientHandlers } from './dumb-ssr-context.js';

export const rootOutletId = '__kinetic_router_root_outlet';
export const outletDelegateAttribute = '__kinetic_router_outlet_delegate'

export type OutletDelegate = {
  setElement(element: Node): void;
  clear(): void;
}

/** The container where the router displays page content. Formerly called Frame.
 * In dumb SSR, renders the matched child as ordinary Solid children without DOM
 * refs/delegates or reserved ids. Layouts must include their child Outlet. */
export const Outlet: typeof Dynamic = (props) => {
  const server = isServer ? useContext(DumbSsrContext) : null;
  if (server) {
    const child = server.renderOutlet();
    return createComponent(Dynamic, merge(withoutClientHandlers(omit(props, 'children')), {
      children: child,
    }) as Parameters<typeof Dynamic>[0]);
  }
  const route = useContext(InRenderedRoute);
  let outletElement: HTMLElement;

  const delegate: OutletDelegate = {
    setElement(element) {
      outletElement.replaceChildren(element)
    },
    clear() {
      outletElement.replaceChildren();
    }
  };

  const setRef = (element: HTMLElement) => {
    outletElement = element;
    if (route === null) {
      element.setAttribute('id', rootOutletId);
      // @ts-ignore
      element[outletDelegateAttribute] = delegate;
    }
  }

  // @ts-ignore
  const res = createComponent(Dynamic, { ...props, ref: setRef });

  if (route !== null) {
    route.subOutlet = delegate;
  }

  return res;
}
