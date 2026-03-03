import { it } from 'vitest';
import { param, parameter, route, root } from "./index.js";

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
_sitemap.users.PARAM.posts.PARAM.getUrl({ postId: 1, userId: 'u', foo: 'x' });

it('type-checks pass', () => {});
