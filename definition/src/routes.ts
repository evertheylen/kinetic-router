import { AnyParamDefs, ParamDef, ParamValues } from "./params.js";
import { Sitemap } from "./sitemap.js";

export type Locator<ParamDefs extends Record<string, ParamDef<any>>> = {
  route: Route<ParamDefs>,
  values: ParamValues<ParamDefs>
}

export class Route<ParamDefs extends Record<string, ParamDef<any>> = any> {
  public paramDefs: ParamDefs;
  /** Ancestor nest routes, ordered from outermost to innermost (closest). Empty for non-nested routes. */
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
    return { route: this, values };
  }

  /** Nesting makes this Route no longer navigable! But it does require implementation. */
  nest<const SubSitemap extends Sitemap>(
    factory: (
      nestedRoute: <const OwnParamDefs extends AnyParamDefs>(
        ownParamDefs: OwnParamDefs
      ) => Route<ParamDefs & OwnParamDefs>
    ) => SubSitemap
  ): SubSitemap {
    // The ancestor list for children = this route's own ancestors + this route itself.
    const ancestorsForChildren: Route[] = [...this.nestedInRoutes, this as Route];

    const nestedRoute = <const OwnParamDefs extends AnyParamDefs>(
      ownParamDefs: OwnParamDefs
    ): Route<ParamDefs & OwnParamDefs> => {
      return new Route({ ...this.paramDefs, ...ownParamDefs }, ancestorsForChildren);
    };

    return factory(nestedRoute);
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

  override locate(values: ParamValues<ParamDefs>): Locator<any> {
    // core aliasing logic
    let locator: Locator<any> = this.aliasFunc(values);
    while (locator.route instanceof Alias) {
      locator = locator.route.aliasFunc(locator.values);
    }
    return locator;
  }
}

