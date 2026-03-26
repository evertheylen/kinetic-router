import { it, describe, expect } from 'vitest';
import { param, route, root, index } from "./index.js";
import { getSlugPath } from "./root.js";

const userId = param.path<string>();
const postId = param.path<number>();

// @ts-expect-error — a bare Route is not a valid root argument
root(route({}));

// PARAM accessor works through deeply nested SubPaths
const _sitemap = {
  [index]: route({}),
  users: {
    [userId.$]: {
      posts: {
        [postId.$]: route({ postId, userId, foo: param.search<string>() })
      }
    }
  }
};

_sitemap.users[userId.$].posts[postId.$].locate({ postId: 1, userId: 'u', foo: 'x' });

it('type-checks pass', () => {});

describe('aliasTo', () => {
  it('locate resolves to the target route and its values', () => {
    const target = route({ id: param.hidden<number>() });
    const alias = route({ id: param.hidden<number>() }).aliasTo((p) => target.locate({ id: p.id }));
    const locator = alias.locate({ id: 42 });
    expect(locator.route).toBe(target);
    expect(locator.values).toEqual({ id: 42 });
  });

  it('locate resolves a chain of aliases down to the actual Route', () => {
    const target = route({ id: param.hidden<number>() });
    const middle = route({ id: param.hidden<number>() }).aliasTo((p) => target.locate({ id: p.id }));
    const alias  = route({ id: param.hidden<number>() }).aliasTo((p) => middle.locate({ id: p.id }));
    const locator = alias.locate({ id: 7 });
    expect(locator.route).toBe(target);
    expect(locator.values).toEqual({ id: 7 });
  });

  it('locate resolves a chain where each alias transforms the params', () => {
    const target = route({ n: param.hidden<number>() });
    const middle = route({ s: param.hidden<string>() }).aliasTo((p) => target.locate({ n: parseInt(p.s, 10) }));
    const alias  = route({ raw: param.hidden<string>() }).aliasTo((p) => middle.locate({ s: p.raw.split(',')[0] }));
    const locator = alias.locate({ raw: '42,blabla,slkdfj' });
    expect(locator.route).toBe(target);
    expect(locator.values).toEqual({ n: 42 });
  });

  it('carries the same paramDefs as the original route', () => {
    const idParam = param.hidden<number>();
    const target = route({ id: idParam });
    const aliased = route({ id: idParam }).aliasTo((p) => target.locate(p));
    expect(aliased.paramDefs).toEqual({ id: idParam });
  });

  it('is still a Route and can be registered in a sitemap at its own slug path', () => {
    const target = route({});
    const alias = route({}).aliasTo(() => target.locate({}));
    const sm = root({ target, alias });
    expect(getSlugPath(sm, alias)).toEqual(['alias']);
    expect(getSlugPath(sm, target)).toEqual(['target']);
  });
});

describe('nest', () => {
  const fooParam = param.search<string>();
  const barParam = param.search<number>();

  it('non-nested routes have an empty nestedInRoutes list', () => {
    const r = route({ fooParam });
    expect(r.nestedInRoutes).toEqual([]);
  });

  it('nested routes have nestedInRoutes containing the nest route', () => {
    const fooRoute = route({ fooParam });
    const sub = fooRoute.nest(nestedRoute => ({
      [index]: nestedRoute({}),
      bar: nestedRoute({ barParam }),
    }));

    expect(sub[index].nestedInRoutes).toHaveLength(1);
    expect(sub[index].nestedInRoutes[0]).toBe(fooRoute);
    expect(sub.bar.nestedInRoutes[0]).toBe(fooRoute);
  });

  it('all siblings from the same nest() share the same ancestor reference', () => {
    const fooRoute = route({ fooParam });
    const sub = fooRoute.nest(nestedRoute => ({
      [index]: nestedRoute({}),
      bar: nestedRoute({ barParam }),
    }));

    expect(sub[index].nestedInRoutes[0]).toBe(sub.bar.nestedInRoutes[0]);
  });

  it('nested routes have merged paramDefs (nest params + own params)', () => {
    const fooRoute = route({ fooParam });
    const sub = fooRoute.nest(nestedRoute => ({
      bar: nestedRoute({ barParam }),
    }));

    expect(sub.bar.paramDefs).toEqual({ fooParam, barParam });
  });

  it('nestedRoute with no extra params has only the nest-level paramDefs', () => {
    const fooRoute = route({ fooParam });
    const sub = fooRoute.nest(nestedRoute => ({
      [index]: nestedRoute({}),
    }));

    expect(sub[index].paramDefs).toEqual({ fooParam });
  });

  it('a plain route() used alongside nest does not get nestedInRoutes set', () => {
    const optOut = route({ fooParam });
    expect(optOut.nestedInRoutes).toEqual([]);
  });

  it('locate() works on a nested route with merged params', () => {
    const fooRoute = route({ fooParam });
    const sub = fooRoute.nest(nestedRoute => ({
      bar: nestedRoute({ barParam }),
    }));

    const locator = sub.bar.locate({ fooParam: 'hello', barParam: 42 });
    expect(locator.route).toBe(sub.bar);
    expect(locator.values).toEqual({ fooParam: 'hello', barParam: 42 });
  });

  it('nested routes are registered in root() with correct slug paths', () => {
    const fooRoute = route({ fooParam });
    const sub = fooRoute.nest(nestedRoute => ({
      [index]: nestedRoute({}),
      bar: nestedRoute({ barParam }),
    }));

    const sm = root({ foo: sub });

    expect(getSlugPath(sm, sub[index])).toEqual(['foo']);
    expect(getSlugPath(sm, sub.bar)).toEqual(['foo', 'bar']);
  });

  it('the nest parent route itself is not registered in root() slugLookup', () => {
    const fooRoute = route({ fooParam });
    const sub = fooRoute.nest(nestedRoute => ({
      child: nestedRoute({}),
    }));

    const sm = root({ foo: sub });
    expect(getSlugPath(sm, fooRoute)).toBeUndefined();
  });

  it('supports multi-level nesting with full ancestor list top-to-bottom', () => {
    const levelParam = param.search<boolean>();

    const fooRoute = route({ fooParam });
    const barRoute = fooRoute.nest(nestedRoute => ({
      // bar is a nested route that itself nests further
      bar: nestedRoute({ barParam }),
      direct: nestedRoute({}),
    }));

    const sub = barRoute.bar.nest(innerNestedRoute => ({
      baz: innerNestedRoute({ levelParam }),
    }));

    // baz.nestedInRoutes = [fooRoute, barRoute.bar] — outermost first
    expect(sub.baz.nestedInRoutes).toHaveLength(2);
    expect(sub.baz.nestedInRoutes[0]).toBe(fooRoute);
    expect(sub.baz.nestedInRoutes[1]).toBe(barRoute.bar);

    // direct is only one level deep
    expect(barRoute.direct.nestedInRoutes).toHaveLength(1);
    expect(barRoute.direct.nestedInRoutes[0]).toBe(fooRoute);
  });

  // Type-level: nestedRoute callback receives correct merged type
  {
    const fooRoute = route({ fooParam });
    const sub = fooRoute.nest(nestedRoute => ({
      bar: nestedRoute({ barParam }),
    }));
    // @ts-expect-error — fooParam is required
    sub.bar.locate({ barParam: 1 });
    // @ts-expect-error — barParam is required
    sub.bar.locate({ fooParam: 'x' });
    // valid
    sub.bar.locate({ fooParam: 'x', barParam: 1 });
  }
});
