import { Route } from "@kinetic-router/definition";
import { isEqual } from "@dovetail-js/utils/equal.js";
import { RenderedRoute } from "./rendered-route.js";
import { AppState } from "./app-state.js";

export type RouteChange = 'render' | 'set-params' | 'nothing';

/** One change per destination route; rerendering an ancestor rerenders its descendants. */
export function calculateRouteChanges(
  from: readonly RenderedRoute[],
  to: {routes: Route<any>[], state: AppState},
): RouteChange[] {
  const result: RouteChange[] = [];
  let i = 0;

  for (; i < to.routes.length; i++) {
    if (from[i]?.route !== to.routes[i]) {
      // also covers when old.routes is shorter than new_.routes
      break;
    }

    let change: RouteChange = 'nothing';
    for (const [pd, value] of from[i].renderArgs.params.ownedValues) {
      const previous = value.reactive ? value.read() : value.value;
      if (isEqual(previous, to.state.paramsByDefinition.get(pd))) continue;
      if (!value.reactive) {
        change = 'render';
        break;
      }
      change = 'set-params';
    }
    if (change === 'render') break;
    result.push(change);
  }

  // an ancestor had to rerender, so make sure that all children also rerender
  for (; i < to.routes.length; i++) {
    result.push('render');
  }

  return result;
}
