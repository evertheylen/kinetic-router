import { describe, it, expect } from 'vitest';
import { param, parameter, route, root } from '@kinetic-router/definition';
import { PageFunctionMap } from './implement.js';

const userId = param.path<string>();
const postId = param.path<number>();

const homeRoute = route({});
const aboutRoute = route({});
const userRoute = route({ userId });

const sm = root({
  home: homeRoute,
  about: aboutRoute,
  users: parameter(userId, userRoute),
});

const stubFunc = async () => ({ html: null as any, title: 'stub' });
const stubLoad = () => Promise.resolve(stubFunc);

describe('PageFunctionMap', () => {
  describe('constructor', () => {
    it('stores the given root sitemap', () => {
      const pfm = new PageFunctionMap(sm);
      expect(pfm.root).toBe(sm);
    });

    it('starts with an empty map', () => {
      const pfm = new PageFunctionMap(sm);
      expect(pfm.map.size).toBe(0);
    });
  });

  describe('implement', () => {
    it('stores a non-lazy entry for the given route', () => {
      const pfm = new PageFunctionMap(sm);
      pfm.implement(homeRoute, stubFunc);
      const entry = pfm.map.get(homeRoute);
      expect(entry).toEqual({ lazy: false, func: stubFunc });
    });

    it('throws when the route is not part of the sitemap', () => {
      const pfm = new PageFunctionMap(sm);
      const foreign = route({});
      expect(() => pfm.implement(foreign, stubFunc)).toThrow(/not part of given root/);
    });

    it('throws when the same route is implemented twice', () => {
      const pfm = new PageFunctionMap(sm);
      pfm.implement(homeRoute, stubFunc);
      expect(() => pfm.implement(homeRoute, stubFunc)).toThrow(/already implemented/);
    });

    it('includes the slug path hint in the duplicate-implementation error', () => {
      const pfm = new PageFunctionMap(sm);
      pfm.implement(aboutRoute, stubFunc);
      expect(() => pfm.implement(aboutRoute, stubFunc)).toThrow(/about/);
    });

    it('allows different routes to be implemented independently', () => {
      const pfm = new PageFunctionMap(sm);
      pfm.implement(homeRoute, stubFunc);
      pfm.implement(aboutRoute, stubFunc);
      expect(pfm.map.size).toBe(2);
    });
  });

  describe('implementLazy', () => {
    it('stores a lazy entry for the given route', () => {
      const pfm = new PageFunctionMap(sm);
      pfm.implementLazy(homeRoute, stubLoad);
      const entry = pfm.map.get(homeRoute);
      expect(entry).toEqual({ lazy: true, load: stubLoad });
    });

    it('throws when the route is not part of the sitemap', () => {
      const pfm = new PageFunctionMap(sm);
      const foreign = route({});
      expect(() => pfm.implementLazy(foreign, stubLoad)).toThrow(/not part of given root/);
    });

    it('throws when the same route is already implemented', () => {
      const pfm = new PageFunctionMap(sm);
      pfm.implementLazy(homeRoute, stubLoad);
      expect(() => pfm.implementLazy(homeRoute, stubLoad)).toThrow(/already implemented/);
    });

    it('lazy and non-lazy implementations conflict with each other on the same route', () => {
      const pfm = new PageFunctionMap(sm);
      pfm.implement(homeRoute, stubFunc);
      expect(() => pfm.implementLazy(homeRoute, stubLoad)).toThrow(/already implemented/);
    });
  });

  describe('check', () => {
    it('does not throw when all routes are implemented', () => {
      const pfm = new PageFunctionMap(sm);
      pfm.implement(homeRoute, stubFunc);
      pfm.implement(aboutRoute, stubFunc);
      pfm.implement(userRoute, stubFunc);
      expect(() => pfm.check()).not.toThrow();
    });

    it('throws when one route has no implementation', () => {
      const pfm = new PageFunctionMap(sm);
      pfm.implement(homeRoute, stubFunc);
      pfm.implement(aboutRoute, stubFunc);
      // userRoute is missing
      expect(() => pfm.check()).toThrow(/No implementation found/);
    });

    it('throws when no routes are implemented at all', () => {
      const pfm = new PageFunctionMap(sm);
      expect(() => pfm.check()).toThrow(/No implementation found/);
    });

    it('includes the missing route slug path in the error message', () => {
      const pfm = new PageFunctionMap(sm);
      pfm.implement(homeRoute, stubFunc);
      pfm.implement(userRoute, stubFunc);
      // aboutRoute is missing
      expect(() => pfm.check()).toThrow(/about/);
    });

    it('lists all missing routes in the error message', () => {
      const pfm = new PageFunctionMap(sm);
      // leave all routes unimplemented
      expect(() => pfm.check()).toThrow(/home/);
    });
  });

  describe('getPageFunction', () => {
    it('returns the stored entry for an implemented route', () => {
      const pfm = new PageFunctionMap(sm);
      pfm.implement(homeRoute, stubFunc);
      const entry = pfm.getPageFunction(homeRoute);
      expect(entry).toEqual({ lazy: false, func: stubFunc });
    });

    it('returns the lazy entry for a lazily implemented route', () => {
      const pfm = new PageFunctionMap(sm);
      pfm.implementLazy(aboutRoute, stubLoad);
      const entry = pfm.getPageFunction(aboutRoute);
      expect(entry).toEqual({ lazy: true, load: stubLoad });
    });

    it('throws when the route is not part of the sitemap', () => {
      const pfm = new PageFunctionMap(sm);
      const foreign = route({});
      expect(() => pfm.getPageFunction(foreign)).toThrow(/not part of given root/);
    });

    it('returns undefined for a route in the sitemap that has not been implemented', () => {
      const pfm = new PageFunctionMap(sm);
      // homeRoute is in the sitemap but nothing has been implemented
      expect(pfm.getPageFunction(homeRoute)).toBeUndefined();
    });
  });
});
