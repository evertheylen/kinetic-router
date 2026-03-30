
import { Dynamic } from "@solidjs/web";
import { InRenderedRoute } from "./route-instance";
import { ComponentProps, createComponent, JSX, omit, useContext } from "solid-js";

export const rootFrameId = '__kinetic_router_root_frame';
export const frameDelegateAttribute = '__kinetic_router_frame_delegate'

export type FrameDelegate = {
  setElement(element: Node): void;
  clear(): void;
}

export const Frame: typeof Dynamic = (props) => {
  const route = useContext(InRenderedRoute);

  let el = createComponent(Dynamic, props);
  if (typeof el === 'function') {
    // @ts-ignore
    el = el();
  }

  if (!(el instanceof HTMLElement)) {
    throw new Error('Frame must be HTMLElement');
  }

  const delegate: FrameDelegate = {
    setElement(element) {
      el.replaceChildren(element)
    },
    clear() {
      el.replaceChildren();
    }
  };

  if (route === null) {
    el.setAttribute('id', rootFrameId);
    // @ts-ignore
    el[frameDelegateAttribute] = delegate;
  } else {
    route.subFrame = delegate;
  }

  return el;
}
