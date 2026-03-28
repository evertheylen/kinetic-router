import { ImplementationMap } from "@kinetic-router/definition/implement.js";
import { RootSitemap } from "@kinetic-router/definition/root.js";
import { Page } from "./page";



// states
type Created = { state: 'created' };
type Initialized = { state: 'initialized', new:  }

export class Router<
  StaticData extends object, Output extends object,
> {
  readonly sitemap: RootSitemap;
  readonly implMap: ImplementationMap<Page<Output, any, any>, StaticData>;

  didInit = false;

  constructor(sitemap: RootSitemap, implMap: ImplementationMap<Page<Output, any, any>, StaticData>) {
    this.sitemap = sitemap;
    this.implMap = implMap;
  }

  async init() {
    if (this.didInit) {
      return;
    }

    this.implMap.check()
  }

  // register with navigation API

}
