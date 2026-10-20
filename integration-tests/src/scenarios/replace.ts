import { root, route } from '@kinetic-router/definition';
import type { Scenario } from '../scenario.js';

export const replace: Scenario = {
  id: 'replace',
  name: 'Replace skips the login page',
  async setup() {
    const { simplePage } = await import('../pages.js');
    const home = route({}), login = route({}), account = route({});
    return { sitemap: root({ home, login, account }), pages: [
      [home, simplePage('Home', { Login: { to: login } })],
      [login, simplePage('Login', { Continue: { to: account, replace: true } })],
      [account, simplePage('Account')],
    ] };
  },
  steps: [
    { expect: { heading: 'Home', history: ['/home'], index: 0, transition: null } },
    { action: { link: 'Login' },
      expect: { heading: 'Login', history: ['/home', '/login'], index: 1, transition: null } },
    { intent: 'Replace Login, don’t push.', action: { button: 'Continue' },
      expect: { heading: 'Account', history: ['/home', '/account'], index: 1, transition: null } },
    { action: { button: 'Back' },
      expect: { heading: 'Home', history: ['/home', '/account'], index: 0, transition: null } },
  ],
};
