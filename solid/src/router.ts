import { ImplementationMap } from "@kinetic-router/definition/implement.js";
import { RootSitemap } from "@kinetic-router/definition/root.js";
import { AnyParamDefs, ParamValues } from "@kinetic-router/definition/params.js";
import { Locator, Route } from "@kinetic-router/definition/routes.js";
import { urlToLocator } from "@kinetic-router/url";

import { Page } from "./page";
import { AppState } from "./app-state";
import { FrameDelegate, frameDelegateAttribute, rootFrameId } from "./frame";



export class Router<
  StaticData extends object, Output extends object,
> {
  readonly sitemap: RootSitemap;
  readonly implMap: ImplementationMap<Page<Output, any, any>, StaticData>;

  // TODO keep cache of RouteInstance!

  /** AppState of which ALL RouteInstance's are rendered */
  loadedAppState: AppState | undefined;
  /** AppState of which at least one RouteInstance has state Initial or ImplLoaded */
  loadingAppState: AppState | undefined;

  rootFrame!: FrameDelegate;

  didStartInit = false;

  constructor(sitemap: RootSitemap, implMap: ImplementationMap<Page<Output, any, any>, StaticData>) {
    this.sitemap = sitemap;
    this.implMap = implMap;
  }

  async init() {
    if (this.didStartInit) {
      return;
    }
    
    this.implMap.check();

    // TODO register with Navigation API

    const locator = urlToLocator(this.sitemap, window.location);

    this.rootFrame = (document.getElementById(rootFrameId)! as any)[frameDelegateAttribute];

    if (this.rootFrame === undefined) {
      throw new Error('No root frame found');
    }

    this.didStartInit = true;
    await this.navigate(locator, { updateCurrent: true });
  }

  async navigate<ParamDefs extends AnyParamDefs>(
    locator: Locator<ParamDefs>,
    options: { updateCurrent?: boolean, forceNewInstance?: boolean }
  ) {
    // TODO implement navigate
  }
}
