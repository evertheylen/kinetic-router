import { JSX } from "solid-js/jsx-runtime";
import { SetStoreFunction, Store } from "solid-js/store";

export type ParamWrapper<T extends object> = {
  read: Store<T>,
  // These two functions do the same: they update the parameters and calling them will result in
  // changed params as 'read'. However, `replace` will replace the current history entry
  // while `setNew` will create a new entry.
  replace: SetStoreFunction<T>,
  setNew: SetStoreFunction<T>
};

export type PageHints = {
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

export type PageHandler<Input extends object, Output extends object = {}> = {
  displayIn: 
  (params: ParamWrapper<Input>, hints: PageHints) => Promise<
    {html: JSX.Element, title: string } & Output
  >
}
