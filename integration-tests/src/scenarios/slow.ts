import { root, route } from '@kinetic-router/definition';
import type { Scenario } from '../scenario.js';

export const slow: Scenario = {
  id: 'slow',
  name: 'History commits before a slow page finishes rendering',
  async setup() {
    const { delayedPage, simplePage } = await import('../pages.js');
    const home = route({}), slow = route({});
    const delayed = delayedPage('Slow');
    return { sitemap: root({ home, slow }), pages: [
      [home, simplePage('Home', { Slow: { to: slow } })],
      [slow, delayed.page],
    ], controls: [{ label: 'Finish rendering', run: delayed.finish }] };
  },
  steps: [
    { expect: { heading: 'Home', history: ['/home'], index: 0, transition: null } },
    { intent: 'Commit now; render later.', action: { link: 'Slow' },
      expect: { heading: 'Home', history: ['/home', '/slow'], index: 1, transition: 'push' } },
    { action: { button: 'Finish rendering' },
      expect: { heading: 'Slow', history: ['/home', '/slow'], index: 1, transition: null, title: 'Slow' } },
  ],
};
