
import { Dynamic } from "@solidjs/web";
import { InRenderedRoute } from "./rendered-route.js";
import { createComponent, useContext } from "solid-js";

export const rootOutletId = '__kinetic_router_root_outlet';
export const outletDelegateAttribute = '__kinetic_router_outlet_delegate'

export type OutletDelegate = {
  setElement(element: Node): void;
  clear(): void;
}

/** The container where the router displays page content. Formerly called Frame. */
export const Outlet: typeof Dynamic = (props) => {
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
