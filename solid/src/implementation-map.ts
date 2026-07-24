import { ImplementationMap } from "@kinetic-router/definition/implementation-map.js";
import { Page, StaticPage } from "./page.js";
import { Route } from "@kinetic-router/definition/routes.js";
import { AnyParamDefs, ParamDef, ParamValues } from "@kinetic-router/definition/params.js";

export class SolidImplementationMap<
  out ExtraStaticData extends object = {},
  out ExtraOutput extends object = {},
> extends ImplementationMap<Page<ExtraOutput, any, any>, StaticPage<any> & ExtraStaticData> {
  public override checkStaticPartOfImpl(route: Route, staticImpl: StaticPage<any> & ExtraStaticData): void {

    // check if untrackedKeys is used correctly
    const isParamDefUntracked = new Map<ParamDef<any>, boolean>();

    for (const [key, pd] of Object.entries(route.paramDefs as AnyParamDefs)) {
      isParamDefUntracked.set(pd, staticImpl.untrackedKeys.includes(key))
    }
    
    for (const ancestorRoute of route.nestedInRoutes) {
      for (const [key, pd] of Object.entries(route.paramDefs as AnyParamDefs)) {
        const routeUntracked = isParamDefUntracked.get(pd)!;
        const ancestorUntracked = this.getStaticPartOfImplementation(ancestorRoute)!.untrackedKeys.includes(key);
        if (routeUntracked !== ancestorUntracked) {
          throw new Error(`Route defines ${key} as ${routeUntracked ? 'untracked' : 'reactive'}, but ancestor route defines it as ${ancestorUntracked ? 'untracked' : 'reactive'}`);
        }
      }
    }
  }

  // no higher order types >:(
  public override implement<ParamDefs extends AnyParamDefs, UntrackedKeys extends (keyof ParamValues<ParamDefs> & string)>(
    route: Route<ParamDefs>,
    impl: Page<ExtraOutput, ParamValues<ParamDefs>, UntrackedKeys> & ExtraStaticData
  ): void {
    super.implement(route, impl as any);
  }

  public override implementLazy<ParamDefs extends AnyParamDefs, UntrackedKeys extends (keyof ParamValues<ParamDefs> & string)>(
    route: Route<ParamDefs>,
    loadImpl: () => Promise<Page<ExtraOutput, ParamValues<ParamDefs>, UntrackedKeys>>,
    staticData: StaticPage<UntrackedKeys> & ExtraStaticData
  ): void {
    super.implementLazy(route, loadImpl as any, staticData);
  }
}
