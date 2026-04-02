import { Json } from "./json.js";
import { Route } from "./routes.js";

export type Serde<T> = {
  serialize(obj: T): Json,
  deserialize(data: Json): T,
}

type Constant = string | number | boolean | bigint | null | undefined;

export abstract class ParamDef<T> {
  serde?: Serde<T>;

  constructor(serde?: Serde<T>) {
    this.serde = serde;
  }
}

interface ParamDefWithDefault<T> extends ParamDef<T> {
  makeDefault: () => T;
}

// PATH PARAMS -------------------------------

const pathParamSymbol: unique symbol = Symbol();

export class PathParamDef<T> extends ParamDef<T> {
  readonly $: symbol;
  static symbolRegistry = new WeakMap<Symbol, PathParamDef<any>>();

  constructor(serde?: Serde<T>) {
    super(serde);
    this.$ = Symbol();
    PathParamDef.symbolRegistry.set(this.$, this);
  }

  withDefault(default_: (() => T) | (T extends Constant ? T : never) ) {
    return new PathParamDefWithDefault<T>(
      typeof default_ === 'function' ? default_ : () => default_, this.serde
    );
  }

  optional() {
    return new PathParamDefWithDefault<T | undefined>(() => undefined, this.serde);
  }
}

export class PathParamDefWithDefault<T> extends PathParamDef<T> implements ParamDefWithDefault<T> {
  makeDefault: () => T;

  constructor(makeDefault: () => T, serde?: Serde<T>) {
    super(serde);
    this.makeDefault = makeDefault;
  }
}


// HIDDEN PARAMS -------------------------------

export class HiddenParamDef<T> extends ParamDef<T> {
  static type = 'hidden';

  withDefault(default_: (() => T) | (T extends Constant ? T : never) ) {
    return new HiddenParamDefWithDefault<T>(
      typeof default_ === 'function' ? default_ : () => default_, this.serde
    );
  }

  optional() {
    return new HiddenParamDefWithDefault<T | undefined>(() => undefined, this.serde);
  }
}

export class HiddenParamDefWithDefault<T> extends HiddenParamDef<T> implements ParamDefWithDefault<T> {
  makeDefault: () => T;

  constructor(makeDefault: () => T, serde?: Serde<T>) {
    super(serde);
    this.makeDefault = makeDefault;
  }
}


// SEARCH PARAMS -------------------------------

export class SearchParamDef<T> extends ParamDef<T> {
  static type = 'search';

  withDefault(default_: (() => T) | (T extends Constant ? T : never) ) {
    return new SearchParamDefWithDefault<T>(
      typeof default_ === 'function' ? default_ : () => default_, this.serde
    );
  }

  optional() {
    return new SearchParamDefWithDefault<T | undefined>(() => undefined, this.serde);
  }
}

export class SearchParamDefWithDefault<T> extends SearchParamDef<T> implements ParamDefWithDefault<T> {
  makeDefault: () => T;

  constructor(makeDefault: () => T, serde?: Serde<T>) {
    super(serde);
    this.makeDefault = makeDefault;
  }
}


export const param = {
  path: <T>(serde?: Serde<T>) => new PathParamDef<T>(serde),
  hidden: <T>(serde?: Serde<T>) => new HiddenParamDef<T>(serde),
  search: <T>(serde?: Serde<T>) => new SearchParamDef<T>(serde),
}

export type AnyParamDefs = Record<string, ParamDef<any>>;

export type ParamMap = Map<ParamDef<any>, any>;

export type ParamValues<ParamDefs extends AnyParamDefs> = (
  { [key in keyof ParamDefs as ParamDefs[key] extends ParamDefWithDefault<any> ? key : never]?: ParamDefs[key] extends ParamDefWithDefault<infer T> ? T : never }
  &
  { [key in keyof ParamDefs as ParamDefs[key] extends ParamDefWithDefault<any> ? never : key]: ParamDefs[key] extends ParamDef<infer T> ? T : never }
);

export function paramsByDefinition<ParamDefs extends AnyParamDefs>(
  params: ParamValues<ParamDefs>,
  definitions: ParamDefs,
): ParamMap {
  return new Map(Object.entries(definitions).map(
    ([key, paramDef]) => [paramDef, (params as any)[key]]
  ))
}

export function paramsByKey<ParamDefs extends AnyParamDefs>(
  params: ParamMap,
  definitions: ParamDefs
): ParamValues<ParamDefs> {
  return Object.fromEntries(Object.entries(definitions).map(
    ([key, paramDef]) => [key, params.get(paramDef)!]
  )) as any;
}
