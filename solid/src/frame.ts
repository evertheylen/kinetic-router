
import { Dynamic } from "@solidjs/web";
import { InRenderedRoute } from "./rendered-route";
import { ComponentProps, createComponent, JSX, omit, useContext } from "solid-js";

export const rootFrameId = '__kinetic_router_root_frame';
export const frameDelegateAttribute = '__kinetic_router_frame_delegate'

export type FrameDelegate = {
  setElement(element: Node): void;
  clear(): void;
}

export const Frame: typeof Dynamic = (props) => {
  const route = useContext(InRenderedRoute);
  let frameElement: HTMLElement;

  const delegate: FrameDelegate = {
    setElement(element) {
      frameElement.replaceChildren(element)
    },
    clear() {
      frameElement.replaceChildren();
    }
  };

  const setRef = (element: HTMLElement) => {
    frameElement = element;
    if (route === null) {
      element.setAttribute('id', rootFrameId);
      // @ts-ignore
      element[frameDelegateAttribute] = delegate;
    }
  }

  // @ts-ignore
  const res = createComponent(Dynamic, { ...props, ref: setRef });

  if (route !== null) {
    route.subFrame = delegate;
  }

  return res;
}
