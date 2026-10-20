import { expect, it } from 'vitest';
import { route } from '@kinetic-router/definition';
import { createOwner, runWithOwner, useContext } from 'solid-js';
import { createParamStorage } from './params.js';
import type { Page } from './page.js';
import { InRenderedRoute, renderRoute, type RenderedRoute } from './rendered-route.js';

it('provides the rendered route without leaking context to unrelated owners', async () => {
  const home = route({});
  const unrelatedOwner = createOwner();
  let seenContext: RenderedRoute | null = null;
  const implementation: Page<{}> = {
    untrackedKeys: [],
    async render() {
      return () => {
        seenContext = useContext(InRenderedRoute);
        return { html: document.createElement('div'), title: 'Home' };
      };
    },
  };
  const params = createParamStorage({ route: home, implementation, paramMap: new Map() });
  try {
    const rendered = await renderRoute({
      route: home,
      implementation,
      renderArgs: { params, pageStatus: {
        shouldFetch: () => true, isVisible: () => true,
        isAnimating: () => false, hasFocus: () => true,
      } },
    });
    expect(seenContext).toBe(rendered);
    expect(runWithOwner(unrelatedOwner, () => useContext(InRenderedRoute))).toBe(null);
  } finally {
    params.owner.dispose();
    unrelatedOwner.dispose();
  }
});
