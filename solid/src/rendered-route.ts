import { createContext, runWithOwner } from "solid-js";

import { Route } from "@kinetic-router/definition/routes.js";

import { Page, PageStatus } from "./page";
import { ParamStorage } from "./params";
import { SolidRoot } from "./utils";
import type { FrameDelegate } from "./frame";


export type RenderedRoute = {
  route: Route,
  implementation: Page<any, any, any>,
  renderArgs: {
    params: ParamStorage,
    pageStatus: PageStatus,
  }
  renderOutput?: {html: Node, title: string },
  owner: SolidRoot,
  subFrame: FrameDelegate | undefined;
};

export const InRenderedRoute = createContext<RenderedRoute | null>(null);

export type RenderArgs = {
  params: ParamStorage,
  pageStatus: PageStatus,
};

export async function renderRoute({ route, implementation, renderArgs }: {
    route: Route<any>,
    implementation: Page<any, any, any>,
    renderArgs: RenderArgs,
  }): Promise<RenderedRoute> {
    const owner = renderArgs.params.owner;
    const renderFunc = await implementation.render(renderArgs.params.untrackedObject);

    const res: RenderedRoute = {
      route,
      implementation,
      renderArgs,
      owner,
      subFrame: undefined,  // to be set later 
    };

    // manually setting Context here (yeah I'm kinda abusing solid here, dont care)
    owner._context[(InRenderedRoute as any).id] = res;
    runWithOwner(owner, () => {
      res.renderOutput = renderFunc(renderArgs.params.reactiveProxyObject, renderArgs.pageStatus);
    });

    return res;
  }

