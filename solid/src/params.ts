import { Accessor, createSignal, runWithOwner, Setter, type Owner } from "solid-js";
import { AnyParamDefs, ParamDef, ParamMap, ParamValues } from "@kinetic-router/definition/params.js";
import { createSolidRoot } from "./utils.js";
import { Page } from "./page.js";
import { Route } from "@kinetic-router/definition/routes.js";


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


export function createParamStorage({parent, route, implementation, paramMap, deferParent = false}: {
  parent?: ParamStorage,
  /** Read inherited destination values without changing a reused live parent.
   * activate() reconnects those reads to the parent's signals. */
  deferParent?: boolean,
  route: Route<any>,
  implementation: Page<any, any, any>,
  paramMap: ParamMap,
}): ParamStorage {
  const routeParamDefs: Set<ParamDef<any>> = new Set<ParamDef<any>>(
    Object.values(route.paramDefs)
  )

  const untrackedParamDefs = new Set(implementation.untrackedKeys.map(k => route.paramDefs[k]));
  const { owner, dispose } = createSolidRoot(parent?.owner);
  
  const ownedParamDefs = (
    parent === undefined
    ? routeParamDefs
    : routeParamDefs.difference(new Set(parent.allValues.keys()))
  );

  const allValues = new Map(parent?.allValues);
  let activate = () => {};
  if (deferParent && parent !== undefined) {
    const [parentActive, setParentActive] = runWithOwner(owner, () => createSignal(false));
    activate = () => { setParentActive(true); };
    for (const [pd, value] of allValues) {
      if (value.reactive) {
        allValues.set(pd, { ...value, read: () => parentActive() ? value.read() : paramMap.get(pd) });
      }
    }
  }
  const ownedValues = new Map<ParamDef<any>, Value<any>>();
  for (const pd of ownedParamDefs) {
    let value: Value<any>;
    if (!untrackedParamDefs.has(pd)) {
      const [ read, write ] = runWithOwner(owner, () => createSignal(paramMap.get(pd)!));
      value = { reactive: true, read, write };
    } else {
      value = { reactive: false, value: paramMap.get(pd)! };
    }
    allValues.set(pd, value);
    ownedValues.set(pd, value);
  }

  // Step 3: make a proxy object to track reads and writes
  const relevantValuesByKey = Object.entries(route.paramDefs as AnyParamDefs).map(
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
    activate,
    ownedValues,
    allValues,
    reactiveProxyObject,
    untrackedObject,
    owner,
    dispose,
  };
}

export type ReactiveValue<T> = { reactive: true, read: Accessor<T>, write: Setter<T> };
// untracked = also constant!
export type UntrackedValue<T> = { reactive: false, readonly value: T }

export type Value<T> = ReactiveValue<T> | UntrackedValue<T>;

// ParamStorage actually creates the owner so it can create signals.
// This owner is reused to render!
export type ParamStorage = {
  parent: ParamStorage | undefined;
  activate(): void;
  owner: Owner;
  dispose(): void;
  allValues: Map<ParamDef<any>, Value<any>>;
  ownedValues: Map<ParamDef<any>, Value<any>>;
  reactiveProxyObject: object,
  untrackedObject: object,
};
