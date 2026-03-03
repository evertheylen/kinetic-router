import { describe, it, expect } from 'vitest';
import { index, param, parameter, route, root } from "./index.js";
import { getSlugPath } from "./root.js";

const userId = param.path<string>();
const postId = param.path<number>();

const usersOverview = route({
  nameFilter: param.search<string>().optional(),
  foobar: param.hidden<number>(),
});

describe('root', () => {
  it('registers routes in SubPaths under their string keys', () => {
    const home = route({});
    const about = route({});
    const sm = root({ home, about });
    expect(getSlugPath(sm, home)).toEqual(['home']);
    expect(getSlugPath(sm, about)).toEqual(['about']);
  });

  it('registers the [index] route at the parent slug path', () => {
    const indexRoute = route({});
    const homeRoute = route({});
    const sm = root({ [index]: indexRoute, home: homeRoute });
    expect(getSlugPath(sm, indexRoute)).toEqual([]);
    expect(getSlugPath(sm, homeRoute)).toEqual(['home']);
  });

  it('registers routes inside a ParameterizedPath using the paramDef as a slug segment', () => {
    const userPage = route({ userId });
    const sm = root(parameter(userId, userPage));
    expect(getSlugPath(sm, userPage)).toEqual([userId]);
  });

  it('registers a withIndex route at the parameterized level', () => {
    const indexRoute = route({});
    const childRoute = route({});
    const sm = root(parameter(userId, { child: childRoute }).withIndex(indexRoute));
    expect(getSlugPath(sm, indexRoute)).toEqual([userId]);
    expect(getSlugPath(sm, childRoute)).toEqual([userId, 'child']);
  });

  it('returns undefined for a route not in the sitemap', () => {
    const sm = root({ home: route({}) });
    expect(getSlugPath(sm, route({}))).toBeUndefined();
  });

  it('handles a realistic nested sitemap', () => {
    const indexR = route({ lastVisited: param.hidden<Date>().optional() }).aliasTo(req =>
      usersOverview.getUrl({ foobar: 123, nameFilter: req.lastVisited === undefined ? 'test' : undefined })
    );
    const postRoute = route({ postId, userId, foo: param.search<string>() });
    const usersIndexRoute = route({});
    const quuzIndexRoute = route({});

    const sm = root({
      [index]: indexR,
      users: parameter(userId, {
        foo: { bar: { quuz: { [index]: quuzIndexRoute } } },
        posts: parameter(postId, postRoute),
      }).withIndex(usersIndexRoute),
    });

    expect(getSlugPath(sm, indexR)).toEqual([]);
    expect(getSlugPath(sm, usersIndexRoute)).toEqual(['users', userId]);
    expect(getSlugPath(sm, quuzIndexRoute)).toEqual(['users', userId, 'foo', 'bar', 'quuz']);
    expect(getSlugPath(sm, postRoute)).toEqual(['users', userId, 'posts', postId]);
  });
});

describe('root validation', () => {
  it('throws when a route uses a path param not scoped by an ancestor ParameterizedPath', () => {
    const orphan = param.path<string>();
    expect(() => root({ home: route({ orphan }) })).toThrow(/path param that is not defined by an ancestor/);
  });

  it('throws when two different routes share the same slug path', () => {
    // parameter(userId, routeB).withIndex(routeA): both routeA and routeB end up at [userId]
    expect(() =>
      root(parameter(userId, route({ userId })).withIndex(route({})))
    ).toThrow(/Two routes share the same slug path/);
  });
});
