import { expect, it } from 'vitest';
import { param, root, route } from '@kinetic-router/definition';
import { SolidImplementationMap } from './implementation-map.js';

const render = async () => () => ({ html: undefined, title: '' });

it('compares inherited untracked parameters by definition identity and each route’s own key', () => {
  const shared = param.hidden<string>();
  const parent = route({ original: shared });
  const child = route({ renamed: shared, own: param.hidden<string>() });
  child.nestedInRoutes = [parent];
  const pages = new SolidImplementationMap(root({ child }));
  pages.implement(parent, { untrackedKeys: ['original'], render });
  pages.implement(child, { untrackedKeys: ['renamed', 'own'], render });
  expect(() => pages.check()).not.toThrow();
});

it('rejects mismatched shared-definition reactivity, but ignores same-named different definitions', () => {
  const parent = route({ shared: param.hidden<string>() });
  const child = parent.nestedRoute({ own: param.hidden<string>() });
  const pages = new SolidImplementationMap(root({ child }));
  pages.implement(parent, { untrackedKeys: ['shared'], render });
  pages.implement(child, { untrackedKeys: ['own'], render });
  expect(() => pages.check()).toThrow('ancestor route');

  const replaced = parent.nestedRoute({ shared: param.hidden<string>() });
  const independent = new SolidImplementationMap(root({ replaced }));
  independent.implement(parent, { untrackedKeys: ['shared'], render });
  independent.implement(replaced, { untrackedKeys: [], render });
  expect(() => independent.check()).not.toThrow();
});
