import { Json } from "./json.js";

export type Serde<T> = {
  serialize(obj: T): Json,
  deserialize(data: Json): T,
}

type ParamType = 'path' | 'search' | 'hidden';

export class ParamDef<ValueT, ParamT extends ParamType = ParamType> {
  type: ParamT;
  serde?: Serde<ValueT>;

  constructor(type: ParamT, serde?: Serde<ValueT>) {
    this.type = type;
    this.serde = serde;
  }

  withDefault(makeDefault: () => ValueT) {
    return new ParamDefWithDefault<ValueT>(this.type, makeDefault, this.serde);
  }

  optional() {
    return new ParamDefWithDefault<ValueT | undefined>(this.type, () => undefined, this.serde);
  }
}

export class ParamDefWithDefault<T> extends ParamDef<T> {
  makeDefault: () => T;

  constructor(type: ParamType, makeDefault: () => T, serde?: Serde<T>) {
    super(type, serde);
    this.makeDefault = makeDefault;
  }
}

export const param = {
  path:   <T>(serde?: Serde<T>) => new ParamDef<T, 'path'>('path', serde),
  hidden: <T>(serde?: Serde<T>) => new ParamDef<T, 'hidden'>('hidden', serde),
  search: <T>(serde?: Serde<T>) => new ParamDef<T, 'search'>('search', serde),
}

export type ParamValues<ParamDefs extends Record<string, ParamDef<any>>> = (
  { [key in keyof ParamDefs as ParamDefs[key] extends ParamDefWithDefault<any> ? key : never]?: ParamDefs[key] extends ParamDefWithDefault<infer T> ? T : never }
  &
  { [key in keyof ParamDefs as ParamDefs[key] extends ParamDefWithDefault<any> ? never : key]: ParamDefs[key] extends ParamDef<infer T> ? T : never }
);
