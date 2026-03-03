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
  shouldLoad: () => boolean,
  isVisible: () => boolean,
  isAnimating: () => boolean,
  hasFocus: () => boolean,
}

export type PageFunction<Input extends object, Output extends object = {}> = (
  (params: ParamWrapper<Input>, hints: PageHints) => Promise<
    {html: JSX.Element, title: string } & Output
  >
)
