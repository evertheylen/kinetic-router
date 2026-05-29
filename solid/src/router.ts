import { RootSitemap } from "@kinetic-router/definition/root.js";
import { SolidImplementationMap } from "./implementation-map";
import { ActualRouter } from "./actual-router";
import { locatorToUrl, urlToLocator } from "@kinetic-router/url";
import { Locator } from "@kinetic-router/definition";
import { Accessor, createSignal, Setter } from "solid-js";

// This class just collects the most useful methods of the various objects
// and centralizes it into one type-safe object that delegates the calls to the 
// correct sub-object. Should never be used within the library, only for clients.

export class Router<
  // Static data about a page, should also be defined upfront for lazy routes
  // example: { 'viewAs': 'mainpage' | 'detail' | 'fullscreen' }
  ExtraStaticData extends object = {},

  // Output (besides html and title) that each page is supposed to give
  // example: opengraph attributes
  ExtraOutput extends object = {},
> {
  implMap: SolidImplementationMap<ExtraStaticData, ExtraOutput>;
  sitemap: RootSitemap;
  protected actualRouter: ActualRouter<ExtraStaticData, ExtraOutput> | undefined;
  protected didInit: Accessor<boolean>;
  protected setDidInit: Setter<boolean>;

  constructor(sitemap: RootSitemap) {
    this.sitemap = sitemap;
    this.implMap = new SolidImplementationMap(this.sitemap);

    this.implement = this.implMap.implement.bind(this.implMap);
    this.implementLazy = this.implMap.implementLazy.bind(this.implMap);

    [this.didInit, this.setDidInit] = createSignal(false);

    queueMicrotask(async () => {
      this.implMap.check();
      const router = new ActualRouter(this.sitemap, this.implMap);
      await router.init();
      this.actualRouter = router;
      this.setDidInit(true);
    });
  }

  // page<Input extends object, UntrackedKeys extends keyof Input = any>(
  //   p: Page<ExtraOutput, Input, UntrackedKeys> & ExtraStaticData
  // ) {
  //   return p;
  // }

  implement: typeof this.implMap.implement;
  implementLazy: typeof this.implMap.implementLazy;

  navigate(...args: Parameters<ActualRouter<ExtraStaticData, ExtraOutput>['navigate']>) {
    if (this.actualRouter === undefined) {
      throw new Error('Router didnt init yet')
    }

    return this.actualRouter.navigate(...args);
  }

  toUrl(locator: Locator<any>) {
    return locatorToUrl(this.sitemap, locator)
  }

  toLocator(url: URL) {
    return urlToLocator(this.sitemap, url);
  }

  currentLocator() {
    if (this.didInit()) {
      return this.actualRouter!.currentLocator();
    } else {
      return undefined;
    }
  }
}
