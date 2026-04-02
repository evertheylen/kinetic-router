import { Route } from "@kinetic-router/definition";
import { AnyParamDefs, ParamDef, ParamMap } from "@kinetic-router/definition/params.js";
import { RenderedRoute } from "./rendered-route";
import { AppState } from "./app-state";


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
  old: {routes: RenderedRoute[], state?: AppState},
  new_: {routes: Route<any>[], state: AppState},
): RouteChange[] {
  const result: RouteChange[] = [];
  let i = 0;

  for (; i < new_.routes.length; i++) {
    if (old.routes[i]?.route !== new_.routes[i]) {
      // also covers when old.routes is shorter than new_.routes
      break;
    }

    const route = new_.routes[i];

    let paramChanged = false;
    for (const pd of Object.values(route.paramDefs as AnyParamDefs)) {
      // TODO use deepEquals of some sort?
      if (old.state === undefined || old.state.paramSnapshot.get(pd) !== new_.state.paramSnapshot.get(pd)) {
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
  for (; i < new_.routes.length; i++) {
    result.push('render');
  }

  return result;
}
