import { isEqual } from '@dovetail-js/utils/equal.js';
import type { RenderedRoute } from './rendered-route.js';
import type { AppState } from './app-state.js';

/** Keep the compatible prefix; rebuilding a parent also rebuilds its children.
 * Reactive parameter changes are applied only when the destination activates. */
export function reusableRoutes(
  from: readonly RenderedRoute[], state: AppState, forceNewInstance = false,
): readonly RenderedRoute[] {
  const routes = [...state.route.nestedInRoutes, state.route];
  const limit = routes.length - (forceNewInstance ? 1 : 0);
  for (let i = 0; i < limit; i++) {
    if (from[i]?.route !== routes[i]) return from.slice(0, i);
    for (const [param, value] of from[i].renderArgs.params.ownedValues) {
      if (!value.reactive && !isEqual(value.value, state.paramsByDefinition.get(param))) {
        return from.slice(0, i);
      }
    }
  }
  return from.slice(0, limit);
}
