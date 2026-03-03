
# `@kinetic-router/solid`

This is the most important package, as it implements the actual router for Solid SPA apps.

It uses these important concepts:

## `ParamWrapper`

```ts
type ParamWrapper<T extends object> = {
    read: Store<T>,
    // These two functions do the same: they update the parameters and calling them will result in
    // changed params as 'read'. However, `replace` will replace the current history entry
    // while `setNew` will create a new entry.
    replace: SetStoreFunction<Params>,
    setNew: SetStoreFunction<Params>
};
```

## `PageHints`

These provide hints towards the state of the page:

```ts
type PageHints = {
    shouldLoad: () => boolean,
    isVisible: () => boolean,
    isAnimating: () => boolean,
    hasFocus: () => boolean,
}
```


## `Page`

The `Page` takes parameters (wrapped). Parameters can be changed through the wrapper only. It does not specify whether they are path/search/hidden parameters. It returns returns `html` along with metadata like `title` and more.
  
```ts
type Page<Input extends object, Output = {}> = (
    (params: ParamWrapper<Input>, hints: PageHints) => Promise<
        {html: JSX.Element, title: string } & Output
    >
)
```


## `Implement`


Each `Route` (that isn't an `Alias`) is mapped to a `Page`.
- a page takes a 
