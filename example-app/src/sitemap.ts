import { param, route, root, index } from "@kinetic-router/definition";

export const agencyId = param.path<string>();
export const serviceBrand = param.path<string>();
export const trainNumber = param.path<string>();

export const homePage = route({});

export const agencyList = route({});
export const serviceBrandList = route({ agencyId });
export const trainList = route({ agencyId, serviceBrand });
export const trainDetail = route({ agencyId, serviceBrand, trainNumber });

export const journeys = route({
  from: param.search<string>(),
  to: param.search<string>(),
  departure: param.search<string>()
});

export const journeyId = param.path<string>();

export const journeyDetail = journeys.nested()

export const sitemap = root({
  [index]: route({}).aliasTo(() => homePage.locate({})),
  home: homePage,
  explore: {
    [index]: agencyList,
    [agencyId.$]:  {
      [index]: serviceBrandList,  //explore/NMBS/brand/
      [serviceBrand.$]: {
        [index]: trainList,  //explore/NMBS/brand/IC/train
        [trainNumber.$]: trainDetail,
      }
    }
  },
  journeys: journeys.nest(subRoute => ({
    [journeyId.$]: 
  })),
  account: route({})
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
