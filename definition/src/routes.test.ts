import { it, describe, expect } from 'vitest';
import { param, parameter, route, root } from "./index.js";
import { getSlugPath } from "./root.js";

const userId = param.path<string>();
const postId = param.path<number>();

// @ts-expect-error — a bare Route is not a valid root argument
root(route({}));

// PARAM accessor works through deeply nested SubPaths
const _sitemap = {
  users: parameter(userId, {
    posts: parameter(postId, route({ postId, userId, foo: param.search<string>() }))
  }).withIndex(route({}))
};
_sitemap.users.PARAM.posts.PARAM.locate({ postId: 1, userId: 'u', foo: 'x' });

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
    // target expects { n: number }
    // middle expects { s: string } and converts s -> n by parsing
    // alias expects { raw: string } and converts raw -> s by uppercasing
    const target = route({ n: param.hidden<number>() });
    const middle = route({ s: param.hidden<string>() }).aliasTo((p) => target.locate({ n: parseInt(p.s, 10) }));
    const alias  = route({ raw: param.hidden<string>() }).aliasTo((p) => middle.locate({ s: p.raw.trim() }));
    const locator = alias.locate({ raw: '  42  ' });
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
