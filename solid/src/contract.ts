import { RootSitemap } from "@kinetic-router/definition/root.js";
import { Page } from "./page";
import { ImplementationMap } from "@kinetic-router/definition/implement.js";

export class RoutingContract<
  // Static data about a page, should also be defined upfront for lazy routes
  // example: { 'viewAs': 'mainpage' | 'detail' | 'fullscreen' }
  StaticData extends object,

  // Output (besides html and title) that each page is supposed to give
  // example: opengraph attributes
  Output extends object,
> {

  page<Input extends object, StaticParams extends keyof Input = any>(
    p: Page<Output, Input, StaticParams> & StaticData
  ) {
    return p;
  }

  implementation(root: RootSitemap) {
    return new ImplementationMap<Page<Output, any, any>, StaticData>(root);
  }

  router() {
    
  }
}
