import { RouteInstance } from "./route-instance";


export class AppState {
  readonly routeInstances: RouteInstance[];
  readonly paramSnapshot: object;

  constructor(routeInstances: RouteInstance[], paramSnapshot: object) {
    this.routeInstances = routeInstances;
    this.paramSnapshot = paramSnapshot;

    console.assert(
      routeInstances[routeInstances.length-1].route.nestedInRoutes.every(
        (r, i) => r === routeInstances[i].route
      ),
      'routeInstances stack differs from route specification'
    );
  }
}
