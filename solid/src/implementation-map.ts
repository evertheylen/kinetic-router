import { ImplementationMap } from "@kinetic-router/definition/implementation-map.js";
import { Page, StaticPage } from "./page.js";
import { Route } from "@kinetic-router/definition/routes.js";
import { AnyParamDefs, ParamValues } from "@kinetic-router/definition/params.js";

export class SolidImplementationMap<
  out ExtraStaticData extends object = {},
  out ExtraOutput extends object = {},
> extends ImplementationMap<Page<ExtraOutput, any, any>, StaticPage<any> & ExtraStaticData> {
  public override checkStaticPartOfImpl(route: Route, staticImpl: StaticPage<any> & ExtraStaticData): void {

    // Inherited values are shared by definition identity, not by local key.
    for (const ancestor of route.nestedInRoutes) {
      const ancestorImpl = this.getStaticPartOfImplementation(ancestor);
      for (const [ancestorKey, ancestorDef] of Object.entries(ancestor.paramDefs as AnyParamDefs)) {
        for (const [key, definition] of Object.entries(route.paramDefs as AnyParamDefs)) {
          if (definition !== ancestorDef) continue;
          const routeUntracked = staticImpl.untrackedKeys.includes(key);
          const ancestorUntracked = ancestorImpl.untrackedKeys.includes(ancestorKey);
          if (routeUntracked !== ancestorUntracked) {
            throw new Error(`Route defines ${key} as ${routeUntracked ? 'untracked' : 'reactive'}, but ancestor route defines it as ${ancestorUntracked ? 'untracked' : 'reactive'}`);
          }
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
