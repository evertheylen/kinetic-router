import { describe, it, expect } from 'vitest';
import { index, param, parameter, route, root } from '@kinetic-router/definition';
import { locatorToUrl } from './serialize.js';
import { urlToLocator } from './deserialize.js';
import { userId, postId, numberSerde, stringSerde } from './test_fixtures.js';

describe('urlToLocator', () => {
  it('matches a simple string-keyed route', () => {
    const home = route({});
    const about = route({});
    const sm = root({ home, about });

    const locator = urlToLocator(sm, '/home');
    expect(locator?.route).toBe(home);
    expect(locator?.values).toEqual({});
  });

  it('matches the [index] route at the root', () => {
    const indexRoute = route({});
    const sm = root({ [index]: indexRoute, home: route({}) });

    expect(urlToLocator(sm, '/')?.route).toBe(indexRoute);
  });

  it('returns undefined for unknown paths', () => {
    const sm = root({ home: route({}) });
    expect(urlToLocator(sm, '/notfound')).toBeUndefined();
  });

  it('matches a parameterized path and deserializes the param', () => {
    const idParam = param.path<number>(numberSerde);
    const r = route({ id: idParam });
    const sm = root(parameter(idParam, r));

    const locator = urlToLocator(sm, '/42');
    expect(locator?.route).toBe(r);
    expect(locator?.values).toEqual({ id: 42 });
  });

  it('matches nested parameterized paths', () => {
    const postRoute = route({ userId, postId });
    const sm = root(parameter(userId, {
      posts: parameter(postId, postRoute),
    }));

    const locator = urlToLocator(sm, '/alice/posts/99');
    expect(locator?.route).toBe(postRoute);
    expect(locator?.values).toMatchObject({ userId: 'alice' });
    // postId has no serde → raw string
    expect(locator?.values.postId).toBe('99');
  });

  it('parses search params into the locator values', () => {
    const r = route({ q: param.search<string>() });
    const sm = root({ search: r });

    const locator = urlToLocator(sm, '/search?q=hello');
    expect(locator?.route).toBe(r);
    expect(locator?.values).toEqual({ q: 'hello' });
  });

  it('parses search params with serde', () => {
    const r = route({ page: param.search<number>(numberSerde) });
    const sm = root({ search: r });

    const locator = urlToLocator(sm, '/search?page=3');
    expect(locator?.route).toBe(r);
    expect(locator?.values).toEqual({ page: 3 });
  });

  it('restores the optional default (undefined) for absent search params', () => {
    const r = route({
      q: param.search<string>(),
      page: param.search<number>(numberSerde).optional(),
    });
    const sm = root({ search: r });

    expect(urlToLocator(sm, '/search?q=hi')?.values).toEqual({ q: 'hi', page: undefined });
  });

  it('restores a declared default value for absent search params', () => {
    const r = route({
      q: param.search<string>(),
      page: param.search<number>(numberSerde).withDefault(() => 1),
    });
    const sm = root({ search: r });

    expect(urlToLocator(sm, '/search?q=hi')?.values).toEqual({ q: 'hi', page: 1 });
  });

  it('leaves absent search params with no default out of values', () => {
    const r = route({
      q: param.search<string>(),
      tag: param.search<string>(),
    });
    const sm = root({ search: r });

    const locator = urlToLocator(sm, '/search?q=hi');
    expect(locator?.values).toEqual({ q: 'hi' });
    expect('tag' in (locator?.values ?? {})).toBe(false);
  });

  it('does not include hidden params in the locator values', () => {
    const r = route({ token: param.hidden<string>() });
    const sm = root({ page: r });

    const locator = urlToLocator(sm, '/page');
    expect(locator?.route).toBe(r);
    expect('token' in (locator?.values ?? {})).toBe(false);
  });

  it('handles absolute URLs', () => {
    const home = route({});
    const sm = root({ home });

    expect(urlToLocator(sm, 'https://example.com/home')?.route).toBe(home);
  });

  it('matches a withoutParam route at the parent path (before the param segment)', () => {
    const usersIndex = route({});
    const sm = root({ users: parameter(userId, { child: route({ userId }) }).withoutParam(usersIndex) });

    const locator = urlToLocator(sm, '/users');
    expect(locator?.route).toBe(usersIndex);
    expect(locator?.values).toEqual({});
  });

  it('matches sub-routes under a withoutParam parameterized level', () => {
    const usersIndex = route({});
    const childRoute = route({ userId });
    const sm = root({ users: parameter(userId, { child: childRoute }).withoutParam(usersIndex) });

    const locator = urlToLocator(sm, '/users/alice/child');
    expect(locator?.route).toBe(childRoute);
    expect(locator?.values).toMatchObject({ userId: 'alice' });
  });

  it('round-trips path params through locatorToUrl → urlToLocator', () => {
    const postIdWS = param.path<number>(numberSerde);
    const postRoute = route({ userId, postId: postIdWS });
    const sm = root(parameter(userId, {
      posts: parameter(postIdWS, postRoute),
    }));

    const url = locatorToUrl(sm, postRoute.locate({ userId: 'carol', postId: 7 }));
    const locator = urlToLocator(sm, url);
    expect(locator?.route).toBe(postRoute);
    expect(locator?.values).toEqual({ userId: 'carol', postId: 7 });
  });

  it('round-trips a non-default search param value', () => {
    const r = route({
      q: param.search<string>(stringSerde),
      page: param.search<number>(numberSerde).withDefault(() => 1),
    });
    const sm = root({ search: r });

    const url = locatorToUrl(sm, r.locate({ q: 'test', page: 5 }));
    expect(urlToLocator(sm, url)?.values).toEqual({ q: 'test', page: 5 });
  });

  it('round-trips a default search param value (omitted then restored)', () => {
    const r = route({
      q: param.search<string>(stringSerde),
      page: param.search<number>(numberSerde).withDefault(() => 1),
    });
    const sm = root({ search: r });

    const url = locatorToUrl(sm, r.locate({ q: 'test', page: 1 }));
    expect(url).toBe('/search?q=test');
    expect(urlToLocator(sm, url)?.values).toEqual({ q: 'test', page: 1 });
  });
});
