import { RootSitemap, slugLookup, slugPathToString } from "@kinetic-router/definition/root.js";
import { Route } from "@kinetic-router/definition/routes.js";
import { AnyParamDefs, ParamDef, ParamValues } from "@kinetic-router/definition/params.js";
import { PageHandler } from "./page.js";

type PageFuncLoader<Input extends object, Output extends object> = (
  { lazy: false, func: PageHandler<Input, Output> }
  | { lazy: true, load: (() => Promise<PageHandler<Input, Output>>) }
);

export class PageFunctionMap<
  ExtraInput extends object = {},
  ExtraOutput extends object = {}
> {
  root: RootSitemap;
  map = new Map<Route<any>, PageFuncLoader<ExtraInput, ExtraOutput>>;

  constructor(root: RootSitemap) {
    this.root = root;
  }

  protected _implement<ParamDefs extends AnyParamDefs>(
    route: Route<ParamDefs>, pageLoader: PageFuncLoader<ExtraInput, ExtraOutput>
  ) {
    const isInSlugMap = this.root[slugLookup].has(route);
    const isNestRoute = !isInSlugMap && this._isKnownNestRoute(route);

    if (!isInSlugMap && !isNestRoute) {
      throw new Error(`Route ${route} is not part of given root`);
    }

    const existingPage = this.map.get(route);
    if (existingPage !== undefined) {
      const slugHint = this.root[slugLookup].get(route);
      const hint = slugHint ? slugPathToString(slugHint) : '(nest route)';
      throw new Error(`Route <${hint}> already implemented: ${existingPage}`);
    }

    // @ts-ignore
    this.map.set(route, pageLoader);
  }

  /** Collect all unique nest ancestor routes referenced by routes in the sitemap. */
  private _collectNestRoutes(): Set<Route<any>> {
    const nestRoutes = new Set<Route<any>>();
    for (const r of this.root[slugLookup].keys()) {
      for (const ancestor of r.nestedInRoutes) {
        nestRoutes.add(ancestor);
      }
    }
    return nestRoutes;
  }

  /** Check whether a given route is a nest ancestor route referenced by routes in the sitemap. */
  private _isKnownNestRoute(route: Route<any>): boolean {
    return this._collectNestRoutes().has(route);
  }

  public implement<ParamDefs extends AnyParamDefs>(
    route: Route<ParamDefs>, func: PageHandler<ParamValues<ParamDefs> & ExtraInput, ExtraOutput>
  ) {
    return this._implement(route, { lazy: false, func: func as any })
  }

  public implementLazy<ParamDefs extends AnyParamDefs>(
    route: Route<ParamDefs>, load: () => Promise<PageHandler<ParamValues<ParamDefs> & ExtraInput, ExtraOutput>>
  ) {
    return this._implement(route, { lazy: true, load: load as any })
  }

  public check() {
    const missingSlugRoutes = [...this.root[slugLookup].keys().filter(route => !this.map.has(route))];
    const missingNestRoutes = [...this._collectNestRoutes()].filter(r => !this.map.has(r));

    const missing = [...missingSlugRoutes, ...missingNestRoutes];

    if (missing.length > 0) {
      const paths = missing.map(r => {
        const slugHint = this.root[slugLookup].get(r);
        return slugHint ? slugPathToString(slugHint) : '(nest route)';
      });
      throw new Error(`No implementation found for ${paths.join(', ')}`);
    }
  }

  public getPageFunction<ParamDefs extends AnyParamDefs>(route: Route<ParamDefs>) {
    if (!this.root[slugLookup].has(route) && !this._isKnownNestRoute(route)) {
      throw new Error(`Route ${route} is not part of given root`);
    }

    return this.map.get(route)!;
  }
}
