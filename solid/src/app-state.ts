import { Json } from "@kinetic-router/definition";
import { RouteInstance } from "./route-instance";
import { StateTransition } from "./state-transition";


function getRandomId(): string {
  return (new Date().toISOString()) + '/' + Math.random().toString(16).slice(2);
}

type RiTrans = StateTransition<RouteInstance<'initial'>, RouteInstance<'rendered'>>;

export class AppState {
  readonly id: string;
  readonly routeInstances: RiTrans[];
  readonly paramSnapshot: object;

  constructor(routeInstances: RiTrans[], paramSnapshot: object) {
    this.id = getRandomId();
    this.routeInstances = routeInstances;
    this.paramSnapshot = paramSnapshot;

    console.assert(
      routeInstances[routeInstances.length-1].from.route.nestedInRoutes.every(
        (r, i) => r === routeInstances[i].from.route
      ),
      'routeInstances stack differs from route specification'
    );
  }

  get mostSpecificRi() {
    return this.routeInstances[this.routeInstances.length-1];
  }

  serialize(): Json {
    // TODO implement serialize
    throw new Error('serialize not implemented');
  }

  static deserialize(data: Json): AppState {
    // TODO implement deserialize
    throw new Error('deserialize not implemented');
  }

  static fromLocator(path: string, search: string): AppState {
    // TODO implement fromUrl
    throw new Error('fromUrl not implemented');
  }
}
