import { root, route } from '@kinetic-router/definition';
import type { Scenario } from '../scenario.js';

export const prune: Scenario = {
  id: 'prune',
  name: 'A new link after Back removes forward history',
  async setup() {
    const { simplePage } = await import('../pages.js');
    const home = route({}), about = route({}), contact = route({});
    return { sitemap: root({ home, about, contact }), pages: [
      [home, simplePage('Home', { About: { to: about }, Contact: { to: contact } })],
      [about, simplePage('About')],
      [contact, simplePage('Contact')],
    ] };
  },
  steps: [
    { expect: { heading: 'Home', history: ['/home'], index: 0, transition: null } },
    { action: { link: 'About' },
      expect: { heading: 'About', history: ['/home', '/about'], index: 1, transition: null } },
    { action: { button: 'Back' },
      expect: { heading: 'Home', history: ['/home', '/about'], index: 0, transition: null } },
    { intent: 'Discard forward history.', action: { link: 'Contact' },
      expect: { heading: 'Contact', history: ['/home', '/contact'], index: 1, transition: null } },
  ],
};
