import { createComponent, createContext, flatten, runWithOwner, untrack } from "solid-js";

import { Route } from "@kinetic-router/definition/routes.js";

import { Page, PageStatus } from "./page.js";
import { ParamStorage } from "./params.js";
import { SolidRoot } from "./utils.js";
import type { FrameDelegate } from "./frame.js";


export type RenderedRoute = {
  route: Route,
  implementation: Page<any, any, any>,
  renderArgs: {
    params: ParamStorage,
    pageStatus: PageStatus,
  }
  renderOutput?: {html: Node, title: string },
  owner: SolidRoot,
  navigationEntryId?: string,
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

    runWithOwner(owner, () => {
      // Use the public context provider: owner internals are mangled in production.
      flatten(createComponent(InRenderedRoute, {
        value: res,
        get children() {
          return untrack(() => {
            let output = renderFunc(renderArgs.params.reactiveProxyObject, renderArgs.pageStatus);
            while (typeof output === 'function') {
              output = output();
            }
            while (typeof output.html === 'function') {
              output.html = output.html();
            }
            res.renderOutput = output;
            return output.html;
          });
        },
      }));
    });

    return res;
  }

