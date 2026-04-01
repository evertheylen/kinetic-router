import { JSX } from "solid-js/jsx-runtime";

export type PageStatus = {
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

export type StaticPage<UntrackedKeys extends string> = {
  readonly untrackedKeys: ReadonlyArray<UntrackedKeys>,
}

export type Page<
  Output extends object,
  Input extends object = any,
  UntrackedKeys extends (keyof Input & string) = any,
> = {
  readonly render: (untrackedParams: {[K in UntrackedKeys]: Input[K]}) => Promise<(
    (reactiveParams: {[K in Exclude<keyof Input, UntrackedKeys>]: Input[K]}, pageStatus: PageStatus) => (
      {html: JSX.Element, title: string } & Output
    )
  )>
} & StaticPage<UntrackedKeys>;
