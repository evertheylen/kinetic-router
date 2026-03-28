import { AnyParamDefs, ParamDef, ParamMap } from "@kinetic-router/definition/params.js";
import { RouteInstance } from "./route-instance";
import { Accessor, createSignal, Setter } from "solid-js";


export function createParamHandlerStack(
  /** as always, first is root, last is most nested */
  routeInstances: RouteInstance<'impl-loaded'>[],

  /** full snapshot of params, enough to satisfy the most nested route */
  paramSnapshot: ParamMap,
) {
  // Step 1: create data for most nested route
  const mostNested = routeInstances[routeInstances.length-1];
  const fullStorage: ParamStorage = {
    parent: undefined, params: new Map()
  };

  for (const [key, pd] of Object.entries(mostNested.route.paramDefs as AnyParamDefs)) {
    if (mostNested.implementation.untrackedKeys.includes(key)) {
      fullStorage.params.set(pd, { reactive: false, value: paramSnapshot.get(pd)})
    } else {
      const [ read, write ] = createSignal(paramSnapshot.get(pd));
      fullStorage.params.set(pd, { reactive: true, read, write });
    }
  }
  
  // Step 2: split it up following the hierarchy
  let previous: ParamStorage | undefined = undefined;
  const paramDefsStoredByAncestor = new Set<ParamDef<any>>();
  const stack: ParamStorage[] = [];

  for (const routeInstance of routeInstances) {
    const routeParamDefs: Set<ParamDef<any>> = new Set<ParamDef<any>>(
      Object.values(routeInstance.route.paramDefs)
    )
    
    const relevantParamDefs = routeParamDefs.difference(paramDefsStoredByAncestor);

    // check correct untrackedKeys usage
    for (const [key, pd] of Object.entries(routeInstance.route.paramDefs as AnyParamDefs)) {
      const value = fullStorage.params.get(pd)!;
      const definedAsReactive = !routeInstance.implementation.untrackedKeys.includes(key);
      if (value.reactive !== definedAsReactive) {
        throw new Error(`Route defines ${key} as ${definedAsReactive ? 'reactive' : 'untracked'}, but some nested route defines it as ${value.reactive ? 'reactive' : 'untracked'}`);
      }
    }

    const params = new Map([...relevantParamDefs].map(pd => [pd, fullStorage.params.get(pd)!]));

    previous = {
      parent: previous,
      params,
    };

    stack.push(previous);
  }
  
  return stack;
}

type ReactiveValue<T> = { reactive: true, read: Accessor<T>, write: Setter<T> };
// untracked = also constant!
type UntrackedValue<T> = { reactive: false, readonly value: T }

type ParamStorage = {
  parent: ParamStorage | undefined;
  params: Map<ParamDef<any>, ReactiveValue<any> | UntrackedValue<any>>;
};

export function findValue(storage: ParamStorage, paramDef: ParamDef<any>) {
  const value = storage.params.get(paramDef)
  if (value !== undefined) {
    return value;
  } else if (storage.parent !== undefined) {
    return findValue(storage.parent, paramDef);
  } else {
    throw new Error(`Couldnt find ${paramDef}`);
  }
}

