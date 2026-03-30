import { Accessor, createOwner, createSignal, runWithOwner, Setter } from "solid-js";
import { AnyParamDefs, ParamDef } from "@kinetic-router/definition/params.js";
import { RouteInstance } from "./route-instance";
import { SolidRoot } from "./utils";


export function createParamStorageStack(
  parent: ParamStorage | undefined,

  /** as always, first is root, last is most nested */
  routeInstances: RouteInstance<'impl-loaded'>[],

  /** full snapshot of params, enough to satisfy the most nested route */
  paramSnapshot: any,
) {
  // Step 1: create param init values for the most-nested route (which has all necessary param defs)
  const mostNested = routeInstances[routeInstances.length-1];
  const allParamInits = new Map<ParamDef<any>, { reactive: boolean, initValue: any }>();

  for (const [key, pd] of Object.entries(mostNested.route.paramDefs as AnyParamDefs)) {
    allParamInits.set(pd, {
      reactive: mostNested.implementation.untrackedKeys.includes(key),
      initValue: paramSnapshot[key]
    });
  }
  
  // Step 2: split them up following the hierarchy, and create signals using a new owner (for each route)

  const paramDefsStoredByAncestor = new Set<ParamDef<any>>();
  let ancestor = parent;
  while (ancestor !== undefined) {
    ancestor.values.keys().forEach(k => paramDefsStoredByAncestor.add(k));
    ancestor = ancestor.parent;
  }

  const stack: ParamStorage[] = [];

  for (const routeInstance of routeInstances) {
    const routeParamDefs: Set<ParamDef<any>> = new Set<ParamDef<any>>(
      Object.values(routeInstance.route.paramDefs)
    )

    // TODO: check if this is ok?
    const o = () => createOwner();
    const owner = parent?.owner !== undefined ? runWithOwner(parent.owner, o) : o();
    
    const relevantParamDefs = routeParamDefs.difference(paramDefsStoredByAncestor);
    const ownedValues = new Map<ParamDef<any>, Value<any>>([...relevantParamDefs].map(pd => {
      const paramInit = allParamInits.get(pd)!;
      if (paramInit.reactive) {
        const [ read, write ] = runWithOwner(owner, () => createSignal(paramInit.initValue));
        return [pd, { reactive: true, read, write }] as const;
      } else {
        return [pd, { reactive: false, value: paramInit.initValue }] as const;
      }
    }));

    // Step 3: make a proxy object to track reads and writes
    const relevantValuesByKey = Object.entries(routeInstance.route.paramDefs as AnyParamDefs).map(
      ([key, pd]) => {
        let value = ownedValues.get(pd);
        // quick little lookup
        if (value !== undefined) {
          ancestor = parent;
          while (ancestor !== undefined) {
            value = ancestor.values.get(pd);
            if (value !== undefined) break;
            ancestor = ancestor.parent;
          }
        }

        // check again
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
    parent = {
      parent: parent,
      values: ownedValues,
      reactiveProxyObject,
      untrackedObject,
      owner
    };
    stack.push(parent);
  }
  
  return stack;
}

type ReactiveValue<T> = { reactive: true, read: Accessor<T>, write: Setter<T> };
// untracked = also constant!
type UntrackedValue<T> = { reactive: false, readonly value: T }

type Value<T> = ReactiveValue<T> | UntrackedValue<T>;

export type ParamStorage = {
  parent: ParamStorage | undefined;
  // ParamStorage is the one making the owner to be able to create signals
  owner: SolidRoot,
  values: Map<ParamDef<any>, Value<any>>;
  reactiveProxyObject: object,
  untrackedObject: object,
};
