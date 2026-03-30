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
  renderOutput: {html: JSX.Element, title: string },
  owner: SolidRoot,
  subFrame: FrameDelegate | undefined;
} & Shared;

export const InRenderedRoute = createContext<Rendered>();

export type RouteInstance<Tag = any> = (Initial | ImplLoaded | Rendered) & { tag: Tag };


export const transitions = {
  makeInitial(initial: Exclude<Initial, 'tag'>): Initial {
    return {...initial, tag: 'initial'}
  },

  async implLoaded(initial: Exclude<Initial, 'tag'>, implMap: SolidImplementationMap<Page<any, any, any>, {}>): Promise<ImplLoaded> {
    const implementation = await implMap.(initial.route);
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
    let renderOutput!: Rendered['renderOutput'];

    runWithOwner(owner, () => {
      renderOutput = renderFunc(args.renderArgs.params.reactiveProxyObject, args.renderArgs.pageState);
    });

    return {
      tag: 'rendered',
      route: implLoaded.route,
      implementation: implLoaded.implementation,
      renderArgs: args.renderArgs,
      renderOutput,
      owner,
    };
  }
}

