import { Route } from "@kinetic-router/definition/routes.js";
import { Page, PageState, ParamWrapper } from "./page";
import { JSX } from "solid-js/jsx-runtime";
import { ImplementationMap } from "@kinetic-router/definition/implement.js";

type Shared = {
  route: Route,
};

/** Waits for the loading implementation promise. */
type Initial = {
  tag: 'initial',
} & Shared;

/** Waits for the rendered page to be present. */
type ImplLoaded = {
  tag: 'impl-loaded',
  implementation: Page<any, any, any>,
  //renderPromise: Promise<(params: ParamWrapper<any>, pageState: PageState) => {html: JSX.Element, title: string }>
} & Shared;

/** Page is ready to be shown. */
type Rendered = {
  tag: 'rendered',
  implementation: Page<any, any, any>,
  params: ParamWrapper<any>,
  pageState: PageState,
  renderOutput: {html: JSX.Element, title: string },
  dispose: () => void,
} & Shared;

export type RouteInstance<Tag = any> = (Initial | ImplLoaded | Rendered) & { tag: Tag };

export function makeInitial(initial: Exclude<Initial, 'tag'>): Initial {
  return {...initial, tag: 'initial'}
}

export const transitions = {
  async implLoaded(initial: Exclude<Initial, 'tag'>, implMap: ImplementationMap<Page<any, any, any>, {}>): Promise<ImplLoaded> {
    const implementation = await implMap.loadRoute(initial.route);
    return {
      ...initial,
      implementation,
      tag: 'impl-loaded'
    }
  },

  async rendered(implLoaded: ImplLoaded, paramSnapshot: object): Promise<Rendered> {
    // TODO limit available keys?
    const renderResult = await implLoaded.implementation.render(paramSnapshot);
    //const paramWrapper = 
    return {} as Rendered;
  }
}

