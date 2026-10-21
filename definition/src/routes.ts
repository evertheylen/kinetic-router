import { AnyParamDefs, convertParamsByDefinition, convertParamsByKey, ParamDef, ParamValues } from "./params.js";
import { Sitemap } from "./sitemap.js";

export type Locator<ParamDefs extends Record<string, ParamDef<any>>> = {
  route: Route<ParamDefs>,
  values: ParamValues<ParamDefs>
}

/** Link destinations: explicit values use a Locator; a bare
 * Route is allowed only when no values are required. Preserve its identity
 * until resolution; never infer values from the currently displayed page. */
export type RouteTarget<ParamDefs extends AnyParamDefs> =
  | Locator<ParamDefs>
  | ({} extends ParamValues<ParamDefs> ? Route<ParamDefs> : never);

export class Route<ParamDefs extends Record<string, ParamDef<any>> = any> {
  public paramDefs: ParamDefs;
  /** Ancestor nest routes, ordered from outermost to innermost (closest). `this` would come at the end. Empty for non-nested routes. */
  public nestedInRoutes: Route[];

  constructor(paramDefs: ParamDefs, nestedInRoutes: Route[] = []) {
    this.paramDefs = paramDefs;
    this.nestedInRoutes = nestedInRoutes;
  }

  aliasTo(aliasFunc: (params: ParamValues<ParamDefs>) => Locator<any>) {
    return new Alias(this.paramDefs, aliasFunc);
  }

  // Returns Locator<any> because Alias may resolve to a different route.
  locate(values: ParamValues<ParamDefs>): Locator<any> {
    return resolveAliases({ route: this, values });
  }

  nestedRoute<const OwnParamDefs extends AnyParamDefs>(ownParamDefs: OwnParamDefs): Route<ParamDefs & OwnParamDefs> {
    // The nestedIn list for children = this route's own ancestors + this route itself.
      return new Route({ ...this.paramDefs, ...ownParamDefs }, [...this.nestedInRoutes, this]);
    };

  /** Nesting makes this Route no longer navigable! But it does require implementation. */
  nest<const SubSitemap extends Sitemap>(
    factory: (
      nestedRoute: <const OwnParamDefs extends AnyParamDefs>(
        ownParamDefs: OwnParamDefs
      ) => Route<ParamDefs & OwnParamDefs>
    ) => SubSitemap
  ): SubSitemap {
    return factory((ownParamDefs) => this.nestedRoute(ownParamDefs));
  }
}

export function route<const ParamDefs extends Record<string, ParamDef<any>>>(paramDefs: ParamDefs) {
  return new Route(paramDefs);
}

export class Alias<ParamDefs extends Record<string, ParamDef<any>>> extends Route<ParamDefs> {
  public aliasFunc: (values: ParamValues<ParamDefs>) => Locator<any>;

  constructor(paramDefs: ParamDefs, aliasFunc: (values: ParamValues<ParamDefs>) => Locator<any>) {
    super(paramDefs);
    this.aliasFunc = aliasFunc;
  }
}

export function resolveAliases(locator: Locator<any>) {
  for (;;) {
    const { route } = locator;
    const values = convertParamsByKey(convertParamsByDefinition(locator.values, route.paramDefs), route.paramDefs);
    if (!(route instanceof Alias)) return { route, values };
    locator = route.aliasFunc(values);
  }
}
