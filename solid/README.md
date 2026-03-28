
# `@kinetic-router/solid`

This is the most important package, as it implements the actual router for Solid SPA apps.

## Scenario

Let's assume this sitemap:

```ts
const sitemap = root({
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
  account: route({})
});
```

1. Initial load of '/'. Follow alias. URL is replaced with '/home'. `homePage` loads. State:
    - active page = [ () ]
