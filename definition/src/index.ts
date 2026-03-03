import { Json } from "./json";

export type Serde<T> = {
  serialize(obj: T): Json,
  deserialize(data: Json): T,
}

type ParamType = 'path' | 'search' | 'hidden';

export class ParamDef<ValueT, ParamT extends ParamType = ParamType> {
  type: ParamT;
  serde?: Serde<ValueT>;

  constructor(type: ParamT, serde?: Serde<ValueT>) {
    this.type = type
    this.serde = serde;
  }

  withDefault(makeDefault: () => ValueT) {
    return new ParamDefWithDefault<ValueT>(this.type, makeDefault, this.serde);
  }

  optional() {
    return new ParamDefWithDefault<ValueT | undefined>(this.type, () => undefined, this.serde);
  }
}

class ParamDefWithDefault<T> extends ParamDef<T> {
  makeDefault: () => T;

  constructor(type: ParamType, makeDefault: () => T, serde?: Serde<T>) {
    super(type, serde);
    this.makeDefault = makeDefault;
  }
}

export const param = {
  path: <T>(serde?: Serde<T>) => new ParamDef('path', serde),
  hidden: <T>(serde?: Serde<T>) => new ParamDef('hidden', serde),
  search: <T>(serde?: Serde<T>) => new ParamDef('search', serde),
}

type ParamValues<ParamDefs extends Record<string, ParamDef<any>>> = (
  {[key in keyof ParamDefs as ParamDefs[key] extends ParamDefWithDefault<any> ? key : never]?: ParamDefs[key] extends ParamDefWithDefault<infer T> ? T : never }
  &
  {[key in keyof ParamDefs as ParamDefs[key] extends ParamDefWithDefault<any> ? never : key]: ParamDefs[key] extends ParamDef<infer T> ? T : never }
);

class Route<ParamDefs extends Record<string, ParamDef<any>>> {
  public paramDefs: ParamDefs;

  constructor(paramDefs: ParamDefs) {
    this.paramDefs = paramDefs;
  }

  aliasTo(aliasFunc: (params: ParamValues<ParamDefs>) => Locator<any>) {
    return new Alias(this.paramDefs, aliasFunc);
  }

  // returns Locator<any> because Alias may overwrite this to specify different routes
  getUrl(values: ParamValues<ParamDefs>): Locator<any> {
    return { route: this, values }
  }
}

export type Locator<ParamDefs extends Record<string, ParamDef<any>>> = {
  route: Route<ParamDefs>,
  values: ParamValues<ParamDefs>
}

class Alias<ParamDefs extends Record<string, ParamDef<any>>> extends Route<ParamDefs> {
  public aliasFunc: (values: ParamValues<ParamDefs>) => Locator<any>;

  constructor(paramDefs: ParamDefs, aliasFunc: (values: ParamValues<ParamDefs>) => Locator<any>) {
    super(paramDefs);
    this.aliasFunc = aliasFunc;
  }
}

export const index: unique symbol = Symbol('kinetic-router:index');

class ParameterizedPath<T, const SubSitemap extends Sitemap> {
  protected paramDef: ParamDef<T, 'path'>;
  PARAM: SubSitemap;

  constructor(paramDef: ParamDef<T, 'path'>, subSitemap: SubSitemap) {
    this.paramDef = paramDef;
    this.PARAM = subSitemap;
  }

  withIndex(route: Route<any>) {
    return new ParameterizedPathWithIndex(this.paramDef, this.PARAM, route);
  }
}

class ParameterizedPathWithIndex<T, const SubSitemap extends Sitemap> extends ParameterizedPath<T, SubSitemap> {
  index: Route<any>;

  constructor(paramDef: ParamDef<T, 'path'>, subSitemap: SubSitemap, index: Route<any>) {
    super(paramDef, subSitemap);
    this.index = index;
  }
}

export function route<const ParamDefs extends Record<string, ParamDef<any>>>(paramDefs: ParamDefs) {
  return new Route(paramDefs);
}

export function parameter<const SubSitemap extends Sitemap>(paramDef: ParamDef<any, 'path'>, subSitemap: SubSitemap) {
  return new ParameterizedPath(paramDef, subSitemap);
}

export type Sitemap = ParameterizedPath<any, any> | SubPaths | Route<any>;
export type SubPaths = {[key in typeof index]?: Route<any>} & {[key in string]: Sitemap | Route<any>};

const slugLookup: unique symbol = Symbol('kinetic-router:slugLookup');

type Slug = (string | ParamDef<any, 'path'>);

export type RootSitemap<Sm extends Sitemap> = Sm & { [slugLookup]: Map<Route<any>, Slug[]> }

export function root<Sm extends Sitemap>(sitemap: Sm): RootSitemap<Sm> {
  // check if path params are used only when they are defined by a node higher up

  // check if each route has a unique slug path and store it in a map

  // return the RootSitemap
}

