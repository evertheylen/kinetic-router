
# `@kinetic-router/definition`

Allows one to define a `Sitemap` with various `Route`'s, each potentially requiring some parameters which can be part of the path, in the URL search parameters or hidden in history state.

Importantly, no meaning is given to the different routes yet — this package is purely a type-safe DSL for declaring route structure.

## Params

Parameters are declared with `param.path<T>()`, `param.search<T>()`, or `param.hidden<T>()`, corresponding to path segments, URL search parameters, and hidden history state respectively. Each variant accepts an optional `Serde` for custom serialization. Params can be made optional (`.optional()`) or given a default (`.withDefault(() => value)`), in which case they become optional in `locate` calls.

## Routes and Sitemaps

A `Route` is created with `route(paramDefs)`. Routes are composed into a sitemap tree using plain objects (string keys map to sub-sitemaps), the `index` symbol (marks the route for the current path level), and `pathParam.$` (introduces a dynamic path segment).

The tree is sealed with `root(sitemap)`, which validates it and returns a `RootSitemap`. Validation ensures:
- every path param used in a route's `paramDefs` is introduced by an ancestor `param.$` key
- no two routes resolve to the same URL pattern

## Aliases

A route can be aliased to another via `.aliasTo(fn)`, where `fn` maps the alias's params to a `Locator` for the target route. Aliases work as follows:
- when generating a link for a certain alias, we resolve the alias until we find an actual `Route`. We use the path of that `Route` and the corresponding parameters to do so.
- when users visit a URL to a certain `Alias` (presumably because it was generated in an earlier version of the app when it wasn't an `Alias` yet), we resolve and forward to the actual `Route`.
