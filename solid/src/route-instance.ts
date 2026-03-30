import { createContext, createOwner, createRoot, Owner, runWithOwner } from "solid-js";
import { JSX } from "solid-js/jsx-runtime";

import { Route } from "@kinetic-router/definition/routes.js";

import { Page, PageState } from "./page";
import { SolidImplementationMap } from "./implementation-map";
import { ParamStorage } from "./params";
import { SolidRoot } from "./utils";
import type { FrameDelegate } from "./frame";

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
  renderArgs: {
    params: ParamStorage,
    pageState: PageState,
  }
  renderOutput?: {html: Node, title: string },
  owner: SolidRoot,
  subFrame: FrameDelegate | undefined;
} & Shared;

export const InRenderedRoute = createContext<Rendered | null>(null);

export type RouteInstance<Tag = any> = (Initial | ImplLoaded | Rendered) & { tag: Tag };


export const transitions = {
  makeInitial(initial: Omit<Initial, 'tag'>): Initial {
    return {...initial, tag: 'initial'}
  },

  async implLoaded(initial: Omit<Initial, 'tag'>, implMap: SolidImplementationMap): Promise<ImplLoaded> {
    const implementation = await implMap.loadImplementation(initial.route);
    return {
      ...initial,
      implementation,
      tag: 'impl-loaded'
    }
  },

  async rendered(implLoaded: ImplLoaded, args: {
    renderArgs: Rendered['renderArgs'],
    owner?: SolidRoot,
  }): Promise<Rendered> {
    const owner = args.renderArgs.params.owner;
    const renderFunc = await implLoaded.implementation.render(args.renderArgs.params.untrackedObject);

    const res: Rendered = {
      tag: 'rendered',
      route: implLoaded.route,
      implementation: implLoaded.implementation,
      renderArgs: args.renderArgs,
      subFrame: undefined,  // to be set later 
      owner,
    };

    // manually setting Context here (yeah I'm kinda abusing solid here, dont care)
    owner._context[(InRenderedRoute as any).id] = res;
    runWithOwner(owner, () => {
      res.renderOutput = renderFunc(args.renderArgs.params.reactiveProxyObject, args.renderArgs.pageState);
    });

    return res;
  }
}

