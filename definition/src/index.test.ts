import { index, param, parameter, route } from "./index.js";

const userId = param.path<string>();
const postId = param.path<number>();

const usersOverview = route({
  nameFilter: param.search<string>().optional(),
  foobar: param.hidden<number>(),  // hidden params with defaults -> page may "expire"
});


const routes = {
  [index]: route({
    lastVisited: param.hidden<Date>().optional()
  }).aliasTo(req => usersOverview.getUrl({ foobar: 123, nameFilter: req.lastVisited === undefined ? 'test' : undefined })),
  users: parameter(
    userId, {
      foo: {
        bar: {
          quuz: {
            [index]: route({})
          }
        }
      },
      posts: parameter(
        postId, route({
          postId,
          userId,
          foo: param.search<string>(),
        })
      )
    }
  ).withIndex(route({}))
};

const x = routes.users.PARAM.foo.bar.quuz[index].getUrl({})

// @ts-expect-error
usersOverview.getUrl({  })


// @ts-expect-error
usersOverview.getUrl({ foobar: 123, nameFilter: 'test', extraProp: true })
