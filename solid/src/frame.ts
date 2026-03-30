
import { InRenderedRoute } from "./route-instance";
import { useContext } from "solid-js";

export const rootFrameId = '__kinetic_router_root_frame';
export const frameDelegateAttribute = '__kinetic_router_frame_delegate'

export type FrameDelegate {
  setElement(element: Node): void;
  clear(): void;
}

export function Frame() {
  const route = useContext(InRenderedRoute);

  const el = document.createElement('div');

  const delegate: FrameDelegate = {
    setElement(element) {
      el.replaceChildren(element)
    },
    clear() {
      el.replaceChildren();
    }
  };

  // @ts-ignore
  el[frameDelegateAttribute] = delegate;

  if (route === undefined) {
    el.setAttribute('id', rootFrameId);
  } else {
    route.subFrame = delegate;
  }

  return el;
}
