import { describe, it, expect } from 'vitest';
import { index, param, route, root } from '@kinetic-router/definition';
import { getSlugPath } from '@kinetic-router/definition/root.js';
import { locatorToUrl, serializePathParams } from './serialize.js';
import { userId, postId, numberSerde } from './test_fixtures.js';

describe('serializePathParams', () => {
  it('projects a prefix by definition identity despite renamed keys, excluding search and hidden params', () => {
    const user = param.path<string>(), post = param.path<number>(numberSerde);
    const userRoot = route({ user });
    const detail = route({ author: user, post, q: param.search<string>(), draft: param.hidden<string>() });
    const sm = root({ users: { [user.$]: { [index]: userRoot, posts: { [post.$]: detail } } } });
    const values = { author: 'alice', post: 42, q: 'recent', draft: 'private' };
    const locator = detail.locate(values);
    const prefix = serializePathParams(sm, locator, getSlugPath(sm, userRoot)!);
    expect([...prefix]).toEqual([[user, 'alice']]);
    expect([...serializePathParams(sm, locator, getSlugPath(sm, detail)!)]).toEqual([[user, 'alice'], [post, '42']]);
    expect(locatorToUrl(sm, locator)).toBe('/users/alice/posts/42?q=recent');
    values.author = 'bob';
    expect(prefix.get(user)).toBe('alice'); // The snapshot does not retain mutable values.
  });

  it('shares parameter and root serde precedence with URL generation', () => {
    const custom = param.path<{ id: number }>({
      serialize: value => `u-${value.id}`,
      deserialize: value => ({ id: Number(String(value).slice(2)) }),
    });
    const fallback = param.path<number>();
    const r = route({ custom, fallback });
    const sm = root({ [custom.$]: { [fallback.$]: r } }, numberSerde);
    const locator = r.locate({ custom: { id: 7 }, fallback: 42 });
    const params = serializePathParams(sm, locator, getSlugPath(sm, r)!);
    expect([...params]).toEqual([[custom, 'u-7'], [fallback, '42']]);
    expect(locatorToUrl(sm, locator)).toBe('/u-7/42');
  });

  it('returns an empty snapshot for static and root-index paths', () => {
    const r = route({ q: param.search<string>(), draft: param.hidden<string>() });
    const sm = root({ [index]: r });
    expect(serializePathParams(sm, r.locate({ q: 'recent', draft: 'private' }), [])).toEqual(new Map());
  });

  it('rejects a path parameter not present in the locator definitions', () => {
    const r = route({}), missing = param.path<string>();
    const sm = root({ home: r });
    expect(() => serializePathParams(sm, r.locate({}), [missing])).toThrow(/no matching key/);
  });
});

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
          posts: {
            [postId.$]: postRoute
          }
        },
      },
    });

    expect(locatorToUrl(sm, rootIndex.locate({}))).toBe('/');
    expect(locatorToUrl(sm, usersIndex.locate({}))).toBe('/users');
    expect(locatorToUrl(sm, quuzIndex.locate({ userId: 'bob' }))).toBe('/users/bob/foo/bar/quuz');
    expect(locatorToUrl(sm, postRoute.locate({ userId: 'bob', postId: 3 }))).toBe('/users/bob/posts/3');
  });

  it('resolves raw alias chains and transformed parameters without mutating the input', () => {
    const id = param.path<number>(numberSerde);
    const target = route({ id, q: param.search<string>(), token: param.hidden<string>() });
    const middle = route({ value: param.hidden<number>() }).aliasTo(p =>
      target.locate({ id: p.value, q: 'converted', token: 'private' }));
    const alias = route({ raw: param.hidden<string>() }).aliasTo(p =>
      middle.locate({ value: Number(p.raw) }));
    const sm = root({ [index]: alias, users: { [id.$]: target } });
    const locator = { route: alias, values: { raw: '42' } };
    expect(locatorToUrl(sm, locator)).toBe('/users/42?q=converted');
    expect(locator.route).toBe(alias);
    expect(locator.values).toEqual({ raw: '42' });
  });

  it('does not require the alias itself to be registered', () => {
    const target = route({});
    const alias = route({}).aliasTo(() => target.locate({}));
    expect(locatorToUrl(root({ target }), { route: alias, values: {} })).toBe('/target');
  });

  it('rejects an unregistered alias destination even when the alias is registered', () => {
    const target = route({});
    const alias = route({}).aliasTo(() => target.locate({}));
    expect(() => locatorToUrl(root({ alias }), { route: alias, values: {} })).toThrow(/not registered/);
  });

  it('throws when route is not in the sitemap', () => {
    const sm = root({ home: route({}) });
    expect(() => locatorToUrl(sm, route({}).locate({}))).toThrow(/not registered/);
  });
});
