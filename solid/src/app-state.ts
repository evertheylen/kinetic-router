import { Json } from "@kinetic-router/definition";
import { RouteInstance } from "./route-instance";


function getRandomId(): string {
  return (new Date().toISOString()) + '/' + Math.random().toString(16).slice(2);
}


export class AppState {
  readonly id: string;
  readonly routeInstances: RouteInstance[];
  readonly paramSnapshot: object;

  constructor(routeInstances: RouteInstance[], paramSnapshot: object) {
    this.id = getRandomId();
    this.routeInstances = routeInstances;
    this.paramSnapshot = paramSnapshot;

    console.assert(
      routeInstances[routeInstances.length-1].route.nestedInRoutes.every(
        (r, i) => r === routeInstances[i].route
      ),
      'routeInstances stack differs from route specification'
    );
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
