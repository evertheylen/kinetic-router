import { describe, it, expect } from 'vitest';
import { index, param, route, root } from '@kinetic-router/definition';
import { locatorToUrl } from './serialize.js';
import { urlToLocator } from './deserialize.js';
import { userId, postId, numberSerde, stringSerde } from './test_fixtures.js';

const parseUrl = (s: string) => new URL(s, 'http://x');

describe('urlToLocator', () => {
  it('matches a simple string-keyed route', () => {
    const home = route({});
    const about = route({});
    const sm = root({ home, about });

    const locator = urlToLocator(sm, parseUrl('/home'));
    expect(locator?.route).toBe(home);
    expect(locator?.values).toEqual({});
  });

  it('matches the [index] route at the root', () => {
    const indexRoute = route({});
    const sm = root({ [index]: indexRoute, home: route({}) });

    expect(urlToLocator(sm, parseUrl('/'))?.route).toBe(indexRoute);
  });

  it('throws for unknown paths', () => {
    const sm = root({ home: route({}) });
    expect(() => urlToLocator(sm, parseUrl('/notfound'))).toThrow(/Couldnt find notfound/);
  });

  it('matches a parameterized path and deserializes the param', () => {
    const idParam = param.path<number>(numberSerde);
    const r = route({ id: idParam });
    const sm = root({[idParam.$]: r});

    const locator = urlToLocator(sm, parseUrl('/42'));
    expect(locator?.route).toBe(r);
    expect(locator?.values).toEqual({ id: 42 });
  });

  it('matches nested parameterized paths', () => {
    const postRoute = route({ userId, postId });
    const sm = root({
      [userId.$]: {
        posts: {
          [postId.$]: postRoute
        }
      }
    });

    const locator = urlToLocator(sm, parseUrl('/alice/posts/99'));
    expect(locator?.route).toBe(postRoute);
    expect(locator?.values).toMatchObject({ userId: 'alice' });
    // postId has no serde → raw string
    expect(locator?.values.postId).toBe('99');
  });

  it('parses search params into the locator values', () => {
    const r = route({ q: param.search<string>() });
    const sm = root({ search: r });

    const locator = urlToLocator(sm, parseUrl('/search?q=hello'));
    expect(locator?.route).toBe(r);
    expect(locator?.values).toEqual({ q: 'hello' });
  });

  it('parses search params with serde', () => {
    const r = route({ page: param.search<number>(numberSerde) });
    const sm = root({ search: r });

    const locator = urlToLocator(sm, parseUrl('/search?page=3'));
    expect(locator?.route).toBe(r);
    expect(locator?.values).toEqual({ page: 3 });
  });

  it('restores the optional default (undefined) for absent search params', () => {
    const r = route({
      q: param.search<string>(),
      page: param.search<number>(numberSerde).optional(),
    });
    const sm = root({ search: r });

    expect(urlToLocator(sm, parseUrl('/search?q=hi'))?.values).toEqual({ q: 'hi', page: undefined });
  });

  it('restores a declared default value for absent search params', () => {
    const r = route({
      q: param.search<string>(),
      page: param.search<number>(numberSerde).withDefault(() => 1),
    });
    const sm = root({ search: r });

    expect(urlToLocator(sm, parseUrl('/search?q=hi'))?.values).toEqual({ q: 'hi', page: 1 });
  });

  it('leaves absent search params with no default out of values', () => {
    const r = route({
      q: param.search<string>(),
      tag: param.search<string>(),
    });
    const sm = root({ search: r });

    const locator = urlToLocator(sm, parseUrl('/search?q=hi'));
    expect(locator?.values).toEqual({ q: 'hi' });
    expect('tag' in (locator?.values ?? {})).toBe(false);
  });

  it('does not include hidden params in the locator values', () => {
    const r = route({ token: param.hidden<string>() });
    const sm = root({ page: r });

    const locator = urlToLocator(sm, parseUrl('/page'));
    expect(locator?.route).toBe(r);
    expect('token' in (locator?.values ?? {})).toBe(false);
  });

  it('handles absolute URLs', () => {
    const home = route({});
    const sm = root({ home });

    expect(urlToLocator(sm, parseUrl('https://example.com/home'))?.route).toBe(home);
  });

  it('matches a noParamGiven route at the parent path (before the param segment)', () => {
    const usersIndex = route({});
    const sm = root({
      users: {
        [index]: usersIndex,
        [userId.$]: {
          child: route({ userId })
        }
      }
    });

    const locator = urlToLocator(sm, parseUrl('/users'));
    expect(locator?.route).toBe(usersIndex);
    expect(locator?.values).toEqual({});
  });

  it('matches sub-routes under a noParamGiven parameterized level', () => {
    const usersIndex = route({});
    const childRoute = route({ userId });
    const sm = root({
      users: {
        [index]: usersIndex,
        [userId.$]: { child: childRoute }
      }
    });

    const locator = urlToLocator(sm, parseUrl('/users/alice/child'));
    expect(locator?.route).toBe(childRoute);
    expect(locator?.values).toMatchObject({ userId: 'alice' });
  });

  it('round-trips path params through locatorToUrl → urlToLocator', () => {
    const postIdWS = param.path<number>(numberSerde);
    const postRoute = route({ userId, postId: postIdWS });
    const sm = root({
      [userId.$]: {
        posts: {
          [postIdWS.$]: postRoute
        }
      }
    });

    const url = locatorToUrl(sm, postRoute.locate({ userId: 'carol', postId: 7 }));
    const locator = urlToLocator(sm, parseUrl(url));
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
    expect(urlToLocator(sm, parseUrl(url))?.values).toEqual({ q: 'test', page: 5 });
  });

  it('round-trips a default search param value (omitted then restored)', () => {
    const r = route({
      q: param.search<string>(stringSerde),
      page: param.search<number>(numberSerde).withDefault(() => 1),
    });
    const sm = root({ search: r });

    const url = locatorToUrl(sm, r.locate({ q: 'test', page: 1 }));
    expect(url).toBe('/search?q=test');
    expect(urlToLocator(sm, parseUrl(url))?.values).toEqual({ q: 'test', page: 1 });
  });
});
