import { describe, it, expect } from 'vitest';
import { index, param, route, root } from '@kinetic-router/definition';
import { locatorToUrl } from './serialize.js';
import { userId, postId, numberSerde } from './test_fixtures.js';

describe('locatorToUrl', () => {
  it('handles a simple SubPaths sitemap with no params', () => {
    const home = route({});
    const about = route({});
    const sm = root({ home, about });

    expect(locatorToUrl(sm, home.locate({}))).toBe('/home');
    expect(locatorToUrl(sm, about.locate({}))).toBe('/about');
  });

  it('handles the [index] route at the root level', () => {
    const indexRoute = route({});
    const sm = root({ [index]: indexRoute, home: route({}) });

    expect(locatorToUrl(sm, indexRoute.locate({}))).toBe('/');
  });

  it('handles a parameterized path segment', () => {
    const userPage = route({ userId });
    const sm = root({[userId.$]: userPage});

    expect(locatorToUrl(sm, userPage.locate({ userId: 'alice' }))).toBe('/alice');
  });

  it('handles nested parameterized paths', () => {
    const postIdWithSerde = param.path<number>(numberSerde);
    const postRoute = route({ userId, postId: postIdWithSerde });
    const sm = root({
      [userId.$]: {
        posts: {
          [postIdWithSerde.$]: postRoute
        }
      }
    });

    expect(locatorToUrl(sm, postRoute.locate({ userId: 'alice', postId: 42 }))).toBe('/alice/posts/42');
  });

  it('appends search params', () => {
    const r = route({
      q: param.search<string>(),
      page: param.search<number>(numberSerde).optional(),
    });
    const sm = root({ search: r });

    expect(locatorToUrl(sm, r.locate({ q: 'hello' }))).toBe('/search?q=hello');
  });

  it('appends multiple search params', () => {
    const r = route({
      q: param.search<string>(),
      page: param.search<number>(numberSerde),
    });
    const sm = root({ search: r });

    const url = locatorToUrl(sm, r.locate({ q: 'world', page: 2 }));
    expect(url).toContain('/search');
    expect(url).toContain('q=world');
    expect(url).toContain('page=2');
  });

  it('omits hidden params from the URL', () => {
    const r = route({ foobar: param.hidden<number>() });
    const sm = root({ page: r });

    expect(locatorToUrl(sm, r.locate({ foobar: 999 }))).toBe('/page');
  });

  it('omits a search param when its value equals the optional default (undefined)', () => {
    const r = route({
      q: param.search<string>(),
      page: param.search<number>(numberSerde).optional(),
    });
    const sm = root({ search: r });

    expect(locatorToUrl(sm, r.locate({ q: 'hi' }))).toBe('/search?q=hi');
    expect(locatorToUrl(sm, r.locate({ q: 'hi', tag: undefined } as any))).toBe('/search?q=hi');
  });

  it('omits a search param when its value equals the declared default', () => {
    const r = route({
      q: param.search<string>(),
      page: param.search<number>(numberSerde).withDefault(() => 1),
    });
    const sm = root({ search: r });

    expect(locatorToUrl(sm, r.locate({ q: 'hi', page: 1 }))).toBe('/search?q=hi');
    expect(locatorToUrl(sm, r.locate({ q: 'hi', page: 2 }))).toBe('/search?q=hi&page=2');
  });

  it('omits a search param when its value equals the optional default (undefined)', () => {
    const r = route({
      q: param.search<string>(),
      tag: param.search<string>().optional(),
    });
    const sm = root({ search: r });

    expect(locatorToUrl(sm, r.locate({ q: 'hi', tag: undefined }))).toBe('/search?q=hi');
    expect(locatorToUrl(sm, r.locate({ q: 'hi', tag: 'news' }))).toBe('/search?q=hi&tag=news');
  });

  it('uses the param serde for path segments', () => {
    const idParam = param.path<number>(numberSerde);
    const r = route({ id: idParam });
    const sm = root({[idParam.$]: r});

    expect(locatorToUrl(sm, r.locate({ id: 7 }))).toBe('/7');
  });

  it('falls back to defaultSerde on the root for path params', () => {
    const idParam = param.path<number>();
    const r = route({ id: idParam });
    const sm = root({[idParam.$]: r}, numberSerde);

    expect(locatorToUrl(sm, r.locate({ id: 42 }))).toBe('/42');
  });

  it('falls back to String() when no serde is available', () => {
    const idParam = param.path<number>();
    const r = route({ id: idParam });
    const sm = root({[idParam.$]: r});

    expect(locatorToUrl(sm, r.locate({ id: 5 }))).toBe('/5');
  });

  it('handles deeply nested SubPaths + parameters', () => {
    const quuzIndex = route({ userId });
    const postRoute = route({ userId, postId });
    const usersIndex = route({});
    const rootIndex = route({});

    const sm = root({
      [index]: rootIndex,
      users: {
        [index]: usersIndex,
        [userId.$]: {
          foo: { bar: { quuz: { [index]: quuzIndex } } },
        },
      },
      posts: {
        [postId.$]: postRoute
      }
    });

    expect(locatorToUrl(sm, rootIndex.locate({}))).toBe('/');
    expect(locatorToUrl(sm, usersIndex.locate({}))).toBe('/users');
    expect(locatorToUrl(sm, quuzIndex.locate({ userId: 'bob' }))).toBe('/users/bob/foo/bar/quuz');
    expect(locatorToUrl(sm, postRoute.locate({ userId: 'bob', postId: 3 }))).toBe('/users/bob/posts/3');
  });

  it('throws when route is not in the sitemap', () => {
    const sm = root({ home: route({}) });
    expect(() => locatorToUrl(sm, route({}).locate({}))).toThrow(/not registered/);
  });
});
