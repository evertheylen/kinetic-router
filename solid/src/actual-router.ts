import { getSlugPath, RootSitemap, slugPathToString } from "@kinetic-router/definition/root.js";
import { AnyParamDefs } from "@kinetic-router/definition/params.js";
import { Alias, Locator, resolveAliases } from "@kinetic-router/definition/routes.js";
import { urlToLocator } from "@kinetic-router/url";

import { PageState } from "./page";
import { AppState } from "./app-state";
import { FrameDelegate, frameDelegateAttribute, rootFrameId } from "./frame";
import { createParamStorage, mapParamObjectToParamInitMap, ParamStorage } from "./params";
import { RouteInstance, transitions } from "./route-instance";
import { SolidImplementationMap } from "./implementation-map";
import { StateTransition, transition } from "./state-transition";
import { createEffect, runWithOwner } from "solid-js";



export class ActualRouter<
  ExtraStaticData extends object,
  ExtraOutput extends object,
> {
  readonly sitemap: RootSitemap;
  readonly implMap: SolidImplementationMap<ExtraStaticData, ExtraOutput>;

  // TODO keep cache of RouteInstance!
  // TODO use Backstage!
  // TODO use AppState!

  /** AppState of which ALL RouteInstance's are rendered */
  loadedAppState: AppState | undefined;
  /** AppState of which at least one RouteInstance has state Initial or ImplLoaded */
  //loadingAppState: AppState | undefined;

  rootFrame!: FrameDelegate;

  constructor(sitemap: RootSitemap, implMap: SolidImplementationMap<ExtraStaticData, ExtraOutput>) {
    this.sitemap = sitemap;
    this.implMap = implMap;
  }

  async init() {
    this.setupNavigationApi();

    const locator = urlToLocator(this.sitemap, window.location);
    // url may be later rewritten by navigate call as window.location may point to Alias

    const rootFrameElement = document.getElementById(rootFrameId);
    if (rootFrameElement === null) {
      throw new Error('No root frame found');
    }

    this.rootFrame = (rootFrameElement as any)[frameDelegateAttribute];

    if (this.rootFrame === undefined) {
      throw new Error('No delegate on root frame found');
    }

    await this.navigate(locator, { updateCurrent: true });
  }

  setupNavigationApi() {
    const router = this;
    window.navigation.addEventListener("navigate", (event) => {
      const url = new URL(event.destination.url);
      const locator = urlToLocator(this.sitemap, url);

      event.intercept({
        async handler() {
          console.debug('Intercepting navigation', {url, locator});
          await router.navigate(locator, {});
        },
      });
    });
  }

  createPageState(): PageState {
    // TODO implement PageState properly
    return {
      shouldFetch: () => true,
      isVisible: () => true,
      isAnimating: () => false,
      hasFocus: () => true
    };
  }

  async navigate<ParamDefs extends AnyParamDefs>(
    locator: Locator<ParamDefs>,
    options: { updateCurrent?: boolean, forceNewInstance?: boolean }
  ) {
    // TODO dont just ignore old RI's duuude
    // TODO respect options

    if (locator.route instanceof Alias) {
      console.warn(`Shouldnt navigate to an alias!`);
      locator = resolveAliases(locator);
    }

    const routeStack = [...locator.route.nestedInRoutes, locator.route];
    const last = routeStack.length - 1;
    const initialRIs = routeStack.map(route => transitions.makeInitial({ route }))
    const implLoadedRIs = initialRIs.map(ri => transitions.implLoaded(ri, this.implMap))

    const allParamInits = mapParamObjectToParamInitMap(
      locator.route.paramDefs,
      // yay it's synchronous!
      this.implMap.getStaticPartOfImplementation(locator.route).untrackedKeys,
      locator.values
    );

    let parentParamStorage: Promise<ParamStorage> | undefined = undefined;
    // we will transition all the way in one go
    const renderedRiTransitions: StateTransition<RouteInstance<'initial'>, RouteInstance<'rendered'>>[] = [];

    for (let i=0; i<routeStack.length; i++) {
      const initial = initialRIs[i];
      const implLoaded = implLoadedRIs[i];

      const paramStorage: Promise<ParamStorage> = Promise.all([implLoaded, parentParamStorage]).then(
        ([il, pps]) => createParamStorage(pps, il, allParamInits)
      );

      parentParamStorage = paramStorage;
      
      const renderedRI = Promise.all([implLoaded, parentParamStorage]).then(
        ([il, ps]) => transitions.rendered(il, {
          renderArgs: { params: ps, pageState: this.createPageState() },
          owner: ps.owner,
        })
      );

      renderedRiTransitions.push(transition(initial, renderedRI));
    }

    const state = new AppState(renderedRiTransitions, locator.values);
    await this.putElementsInDocument(state);

    // TODO: enable graceful degradation without the window.navigation API (iOS 26.1 and lower!)
    window.navigation.updateCurrentEntry({
      state: locator.values,
    })
  }

  async putElementsInDocument(appState: AppState) {
    let frame: FrameDelegate | undefined = this.rootFrame;
    for (const transition of appState.routeInstances) {
      if (frame === undefined) {
        const slugPath = getSlugPath(this.sitemap, transition.from.route)!;
        const slugPathStr = slugPathToString(slugPath);
        throw new Error(`Cant render ${slugPathStr}: no frame!`);
      }

      const renderedRI = await transition.to;

      frame.setElement(renderedRI.renderOutput!.html);
      frame = renderedRI.subFrame;

      if (transition === appState.mostSpecificRi) {
        runWithOwner(renderedRI.owner, () => createEffect(
          () => renderedRI.renderOutput!.title,
          (title) => { document.title = title }
        ));
      }
    }
  }
}
