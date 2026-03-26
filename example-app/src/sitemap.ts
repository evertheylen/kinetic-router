import { param, route, root, index, parameter, missing } from "@kinetic-router/definition";

export const agencyId = param.path<string>();
export const serviceBrand = param.path<string>();
export const trainNumber = param.path<number>();

export const homePage = route({});

export const agencyList = route({});
export const serviceBrandList = route({ agencyId });
export const trainList = route({ agencyId, serviceBrand });
export const trainDetail = route({ agencyId, serviceBrand, trainNumber });

export const sitemap = root({
  [index]: homePage,
  explore: parameter(agencyId, {
    [missing]: agencyList,  //explore/
    brand: parameter(serviceBrand, {
      [missing]: serviceBrandList,  //explore/NMBS/brand/
      train: parameter(trainNumber, {
        [missing]: trainList,  //explore/NMBS/brand/IC/train
        [index]: trainDetail,
      })
    }),
  }),
  posts: parameter(postId, {
    [missing]: postList,
    [index]: postDetail,
  })
});

const x = {
  [index]: homePage,
  explore: {
    [index]: 
    [agencyId.$]: 
  }
}

function test(): 'test' {
  return 'test'
};

const a = {
  test: 1,
  test: 2,
}

class Foo {
  [Symbol.toPrimitive]() {
    return 'test'
  }
}

const b = {
  [a]: 
  
}
