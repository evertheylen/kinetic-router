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
    if (!this.root[slugLookup].has(route)) {
      throw new Error(`Route ${route} is not part of given root`);
    }

    const existingPage = this.map.get(route);
    if (existingPage !== undefined) {
      const hint = slugPathToString(this.root[slugLookup].get(route)!);
      throw new Error(`Route <${hint}> already implemented: ${existingPage}`);
    }

    // @ts-ignore
    this.map.set(route, pageLoader);
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
    const noMatch = [...this.root[slugLookup].keys().filter(route => !this.map.has(route))];

    if (noMatch.length > 0) {
      const paths = noMatch.map(r => slugPathToString(this.root[slugLookup].get(r)!));
      throw new Error(`No implementation found for ${paths.join(', ')}`);
    }
  }

  public getPageFunction<ParamDefs extends AnyParamDefs>(route: Route<ParamDefs>) {
    if (!this.root[slugLookup].has(route)) {
      throw new Error(`Route ${route} is not part of given root`);
    }

    return this.map.get(route)!;
  }
}
