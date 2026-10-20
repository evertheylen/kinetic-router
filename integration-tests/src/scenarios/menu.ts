import { index, root, route } from '@kinetic-router/definition';
import type { Scenario } from '../scenario.js';

export const menu: Scenario = {
  id: 'menu',
  name: 'Menu roots resume committed visits in both history directions',
  async setup() {
    const { simplePage } = await import('../pages.js');
    const home = route({}), a = route({}), detail = route({}), b = route({});
    const controls = { A: { to: a, mode: 'menu' as const }, B: { to: b, mode: 'menu' as const }, Detail: { to: detail } };
    return { sitemap: root({ home, a: { [index]: a, detail }, b }), pages: [
      [home, simplePage('Home', controls)],
      [a, simplePage('A', controls)],
      [detail, simplePage('Detail', controls)],
      [b, simplePage('B', controls)],
    ] };
  },
  steps: [
    { expect: { heading: 'Home', history: ['/home'], index: 0 } },
    { action: { link: 'Detail' }, expect: { heading: 'Detail', history: ['/home', '/a/detail'], index: 1 } },
    { intent: 'No preceding root: replace Detail with A.', action: { button: 'A' },
      expect: { heading: 'A', history: ['/home', '/a'], index: 1 } },
    { action: { link: 'Detail' }, expect: { heading: 'Detail', history: ['/home', '/a', '/a/detail'], index: 2 } },
    { intent: 'Unvisited B: push its root.', action: { button: 'B' },
      expect: { heading: 'B', history: ['/home', '/a', '/a/detail', '/b'], index: 3 } },
    { action: { button: 'A' }, expect: { heading: 'Detail', index: 2 } },
    { intent: 'Inside A: traverse to its preceding root.', action: { button: 'A' },
      expect: { heading: 'A', index: 1 } },
    { intent: 'Already at the root: no-op.', action: { button: 'A' },
      expect: { heading: 'A', history: ['/home', '/a', '/a/detail', '/b'], index: 1 } },
    { intent: 'Resume B forward without discarding Detail.', action: { button: 'B' },
      expect: { heading: 'B', history: ['/home', '/a', '/a/detail', '/b'], index: 3 } },
    { intent: 'A now remembers its root, not its deepest entry.', action: { button: 'A' },
      expect: { heading: 'A', index: 1 } },
    { action: { button: 'Forward' }, expect: { heading: 'Detail', index: 2 } },
    { action: { button: 'Forward' }, expect: { heading: 'B', index: 3 } },
    { intent: 'Forward committed a new A bookmark.', action: { button: 'A' },
      expect: { heading: 'Detail', history: ['/home', '/a', '/a/detail', '/b'], index: 2 } },
  ],
};
