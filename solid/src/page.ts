import { JSX } from "solid-js/jsx-runtime";

export type SimpleSetter<T> = (values: Partial<T>) => void;

export type ReactiveParamWrapper<Input extends object> = {
  values: { readonly [P in keyof Input]: Input[P]; },
  // These two functions do the same: they update the parameters and calling them will result in
  // changed params as 'read'. However, `replace` will replace the current history entry
  // while `setNew` will create a new entry.
  replace: SimpleSetter<Input>,
  setNew: SimpleSetter<Input>
};

export type PageState = {
  /** Should the page fetch resources? False when the page is somewhere in the
   * history stack and not currently being viewed. True when preloading a new page 
   * or currently visible. */
  shouldFetch: () => boolean,

  /** The current page is visible to the user, in whatever state that might be. */
  isVisible: () => boolean,

  /** The page is begin animated. */
  isAnimating: () => boolean,

  /** The page is visible and the most specific one when it comes to nesting. */
  hasFocus: () => boolean,
}

export type Page<
  Output extends object,
  Input extends object = any,
  UntrackedKeys extends keyof Input = any,
> = {
  readonly untrackedKeys: ReadonlyArray<UntrackedKeys>,
  readonly render: (untrackedKeys: {[K in UntrackedKeys]: Input[K]}) => Promise<(
    (params: ReactiveParamWrapper<{[K in Exclude<keyof Input, UntrackedKeys>]: Input[K]}>, pageState: PageState) => (
      {html: JSX.Element, title: string } & Output
    )
  )>
}
