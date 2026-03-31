import { Accessor, createOwner, createSignal, runWithOwner, Setter } from "solid-js";
import { AnyParamDefs, ParamDef, ParamValues } from "@kinetic-router/definition/params.js";
import { RouteInstance } from "./route-instance";
import { SolidRoot } from "./utils";


export type ParamInit = Map<ParamDef<any>, { reactive: boolean, initValue: any }>;


export function mapParamObjectToParamInitMap<ParamDefs extends AnyParamDefs>(
  paramDefs: ParamDefs,
  untrackedKeys: ReadonlyArray<keyof ParamDefs>,
  snapshot: ParamValues<ParamDefs>,
) {
  const allParamInits: ParamInit = new Map();

  for (const [key, pd] of Object.entries(paramDefs)) {
    allParamInits.set(pd, {
      reactive: !untrackedKeys.includes(key),
      initValue: (snapshot as any)[key]
    });
  }

  return allParamInits;
}


export function createParamStorage(
  parent: ParamStorage | undefined,
  routeInstance: RouteInstance<'impl-loaded'>,
  allParamInits: ParamInit,
): ParamStorage {
  const routeParamDefs: Set<ParamDef<any>> = new Set<ParamDef<any>>(
    Object.values(routeInstance.route.paramDefs)
  )

  const owner = parent?.owner !== undefined ? runWithOwner(parent.owner, createOwner) : createOwner();
  
  const ownedParamDefs = (
    parent === undefined
    ? routeParamDefs
    : routeParamDefs.difference(new Set(parent.allValues.keys()))
  );

  const allValues = new Map(parent?.allValues);
  const ownedValues = new Map<ParamDef<any>, Value<any>>();
  for (const pd of ownedParamDefs) {
    const paramInit = allParamInits.get(pd)!;
    let value: Value<any>;
    if (paramInit.reactive) {
      const [ read, write ] = runWithOwner(owner, () => createSignal(paramInit.initValue));
      value = { reactive: true, read, write };
    } else {
      value = { reactive: false, value: paramInit.initValue };
    }
    allValues.set(pd, value);
    ownedValues.set(pd, value);
  }

  // Step 3: make a proxy object to track reads and writes
  const relevantValuesByKey = Object.entries(routeInstance.route.paramDefs as AnyParamDefs).map(
    ([key, pd]) => {
      let value = allValues.get(pd);
      
      if (value === undefined) {
        throw new Error(`Couldnt find Value for ${key}`);
      }

      return [key, value] as const
    }
  )

  const relevantReactiveValuesByKey = Object.fromEntries(
    relevantValuesByKey.filter(([key, value]) => value.reactive)
  );

  const reactiveProxyObject = new Proxy(relevantReactiveValuesByKey, {
    get(target, p, receiver) {
      const value = target[p as string];
      if (value.reactive) {
        return value.read();
      } else {
        return value.value;
      }
    },
  });

  // Step 4: Also make a simple object to store untracked values
  const untrackedObject = Object.fromEntries(
    relevantValuesByKey
    .filter(([key, value]) => !value.reactive)
    .map(([key, value]) => [key, (value as UntrackedValue<any>).value])
  );

  // Step 5: store in stack
  return {
    parent: parent,
    ownedValues,
    allValues,
    reactiveProxyObject,
    untrackedObject,
    owner
  };
}

type ReactiveValue<T> = { reactive: true, read: Accessor<T>, write: Setter<T> };
// untracked = also constant!
type UntrackedValue<T> = { reactive: false, readonly value: T }

type Value<T> = ReactiveValue<T> | UntrackedValue<T>;

// ParamStorage actually creates the owner so it can create signals.
// This owner is reused to render!
export type ParamStorage = {
  parent: ParamStorage | undefined;
  owner: SolidRoot,
  allValues: Map<ParamDef<any>, Value<any>>;
  ownedValues: Map<ParamDef<any>, Value<any>>;
  reactiveProxyObject: object,
  untrackedObject: object,
};
