import { Dynamic, isServer } from "@solidjs/web";
import { InRenderedRoute } from "./rendered-route.js";
import { createComponent, merge, omit, useContext } from "solid-js";
import { DumbSsrContext, withoutClientHandlers } from './dumb-ssr-context.js';

export const rootOutletId = '__kinetic_router_root_outlet';
export const outletDelegateAttribute = '__kinetic_router_outlet_delegate';

export type OutletDelegate = {
  setElement(element: Node): void;
  clear(): void;
  /** Keep the old node for an exit. The returned function removes it, or restores
   * it in the slot when called with true (rollback or reentry). */
  retainExit?(element: Node): (keepElement?: boolean) => void;
};

type ExitPresentation = { node: ChildNode; restore?(): void };

/** @internal Outlet and MotionOutlet share routing registration and server markup.
 * The optional callback presents outgoing content only in live slots, never Backstage. */
export function createOutlet(presentExit?: (outlet: HTMLElement, element: Node) => ExitPresentation): typeof Dynamic {
  return (props) => {
    const server = isServer ? useContext(DumbSsrContext) : null;
    if (server) {
      const child = server.renderOutlet();
      return createComponent(Dynamic, merge(withoutClientHandlers(omit(props, 'children')), {
        children: child,
      }) as Parameters<typeof Dynamic>[0]);
    }
    const route = useContext(InRenderedRoute);
    let outletElement: HTMLElement;
    const outgoing = presentExit && new Set<ChildNode>();
    const clear = (keep?: Node) => {
      if (!keep && !outgoing?.size) outletElement.replaceChildren();
      else for (const child of Array.from(outletElement.childNodes)) {
        if (child !== keep && !outgoing?.has(child)) child.remove();
      }
    };

    const delegate: OutletDelegate = {
      setElement(element) {
        const attached = element.parentNode === outletElement;
        if (attached && !outgoing) return;
        if (outgoing?.size || attached) {
          clear(element);
          if (!attached) outletElement.prepend(element);
        } else {
          outletElement.replaceChildren(element);
        }
      },
      clear: () => clear(),
      ...(presentExit && { retainExit(element: Node) {
        const { node, restore } = presentExit(outletElement, element);
        outgoing!.add(node);
        return keepElement => {
          outgoing!.delete(node);
          if (!keepElement) node.remove();
          else if (node !== element) node.replaceWith(element);
          restore?.();
        };
      } }),
    };

    const setRef = (element: HTMLElement) => {
      outletElement = element;
      if (route === null) {
        element.setAttribute('id', rootOutletId);
        Object.assign(element, { [outletDelegateAttribute]: delegate });
      }
    };

    // @ts-ignore
    const res = createComponent(Dynamic, { ...props, ref: setRef });
    if (route !== null) route.subOutlet = delegate;
    return res;
  };
}

/** The container where the router displays page content. Pages snap into place
 * and are removed immediately. In dumb SSR, renders the matched child as ordinary
 * Solid children without DOM refs/delegates or reserved ids. Layouts must include
 * their child Outlet. */
export const Outlet = createOutlet();
