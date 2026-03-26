import { param, route, root, index, parameter, missing } from "@kinetic-router/definition";

export const userId = param.path<string>();
export const postId = param.path<number>();

export const userList = route({
  nameFilter: param.search<string>().optional(),
});

export const userDetail = route({ userId });

export const userFriendList = route({ userId });

export const postList = route({
  postFilter: param.search<string>().optional(),
});

export const postDetail = route({ postId });

export const homePage = route({});

export const sitemap = root({
  [index]: homePage,
  users: parameter(userId, {
    [missing]: userList,
    [index]: userDetail,
    friends: userFriendList
  }),
  posts: parameter(postId, {
    [missing]: postList,
    [index]: postDetail,
  })
});
