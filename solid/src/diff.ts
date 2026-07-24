import { Route } from "@kinetic-router/definition";
import { AnyParamDefs, ParamDef, ParamMap } from "@kinetic-router/definition/params.js";
import { RenderedRoute } from "./rendered-route.js";
import { AppState } from "./app-state.js";


/** Different route entirely OR same route but untracked params changed, so rerender (or explicitly asked in navigate call) */
export type NeedRender = {
  type: 'render',
  newRoute: Route<any>,
  params: ParamMap,
};

/** same route, can change without rerender */
export type SetParams = {
  type: 'set-params',
  renderedRoute: RenderedRoute,
};

/** the routes are equal and so are the params */
export type DoNothing = {
  type: 'nothing'
}

export type RouteChange = 'render' | 'set-params' | 'nothing';
//NeedRender | SetParams | DoNothing;

/** Returns an array of required route changes of the same size as routes.new */
export function calculateRouteChanges(
  untrackedParamDefs: Set<ParamDef<any>>,
  from: RenderedRoute[],
  to: {routes: Route<any>[], state: AppState},
): RouteChange[] {
  const result: RouteChange[] = [];
  let i = 0;

  for (; i < to.routes.length; i++) {
    if (from[i]?.route !== to.routes[i]) {
      // also covers when old.routes is shorter than new_.routes
      break;
    }

    const route = to.routes[i];

    let paramChanged = false;
    for (const pd of Object.values(route.paramDefs as AnyParamDefs)) {
      // TODO use deepEquals of some sort?
      if (from[i].renderArgs.params.ownedValues.get(pd) !== to.state.paramsByDefinition.get(pd)) {
        if (untrackedParamDefs.has(pd)) {
          // worst case scenario, we're certain that we have to rerender so return that
          result.push('render');
          break;
        }
        // a param changed, but we're still holding out hope that we can get away with setting params
        paramChanged = true;
      }
    }

    result.push(paramChanged ? 'set-params' : 'nothing')
  }

  // an ancestor had to rerender, so make sure that all children also rerender
  for (; i < to.routes.length; i++) {
    result.push('render');
  }

  return result;
}
