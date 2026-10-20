import { root, route } from '@kinetic-router/definition';
import type { Scenario } from '../scenario.js';

export const links: Scenario = {
  id: 'links',
  name: 'Links, back/forward, and cached page state',
  async setup() {
    const { simplePage } = await import('../pages.js');
    const home = route({}), about = route({});
    return { sitemap: root({ home, about }), pages: [
      [home, simplePage('Home', { About: { to: about } })],
      [about, simplePage('About')],
    ] };
  },
  steps: [
    { expect: { heading: 'Home', history: ['/home'], index: 0, notes: '', transition: null } },
    { action: { fill: 'Notes', value: 'Keep this note' },
      expect: { notes: 'Keep this note', history: ['/home'], index: 0 } },
    { action: { link: 'About' },
      expect: { heading: 'About', history: ['/home', '/about'], index: 1, transition: null } },
    { intent: 'Same note and fingerprint.', action: { button: 'Back' },
      expect: { heading: 'Home', history: ['/home', '/about'], index: 0, notes: 'Keep this note', transition: null } },
    { action: { button: 'Forward' },
      expect: { heading: 'About', history: ['/home', '/about'], index: 1, transition: null } },
  ],
};
