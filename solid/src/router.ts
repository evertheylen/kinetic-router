import { RootSitemap } from "@kinetic-router/definition/root.js";
import { SolidImplementationMap } from "./implementation-map";
import { ActualRouter } from "./actual-router";

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

  constructor(sitemap: RootSitemap) {
    this.sitemap = sitemap;
    this.implMap = new SolidImplementationMap(this.sitemap);

    document.addEventListener('onload', async () => {
      this.implMap.check();
      const router = new ActualRouter(this.sitemap, this.implMap);
      await router.init()
      this.actualRouter = router;
    });
  }

  // page<Input extends object, UntrackedKeys extends keyof Input = any>(
  //   p: Page<ExtraOutput, Input, UntrackedKeys> & ExtraStaticData
  // ) {
  //   return p;
  // }

  implement(...args: Parameters<typeof this.implMap.implement>) {
    return this.implMap.implement(...args);
  }

  implementLazy(...args: Parameters<typeof this.implMap.implementLazy>) {
    return this.implMap.implementLazy(...args);
  }

  navigate(...args: Parameters<ActualRouter<ExtraStaticData, ExtraOutput>['navigate']>) {
    if (this.actualRouter === undefined) {
      throw new Error('Router didnt init yet')
    }

    return this.actualRouter.navigate(...args);
  }
}
