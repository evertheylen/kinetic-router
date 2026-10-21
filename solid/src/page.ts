import type { JSX } from "@solidjs/web";

/** Reactive lifecycle accessors, not an automatic resource/freshness policy.
 * Backstage output can fetch while invisible and unfocused. Gate autofocus,
 * analytics, and other activation-only effects on visibility or page focus. */
export type PageStatus = {
  /** True while preparing, visible, or requested by a preparation consumer.
   * Unrequested retained pages stop fetching; disposal ends every request. */
  shouldFetch: () => boolean,

  /** Non-aborted during the current fetch-active period, undefined while idle.
   * Aborted when fetching ends; resumption supplies a fresh signal. Track this
   * accessor in reactive resource code and pass the signal to your loaders. */
  fetchSignal: () => AbortSignal | undefined,

  /** True for the active page stack, including its ancestor layouts. */
  isVisible: () => boolean,

  /** Reserved for page transitions; currently always false. The Navigation API's
   * navigation.transition tracks pending rendering, not visual animation. */
  isAnimating: () => boolean,

  /** True only for the active leaf page, not its ancestor layouts. */
  hasFocus: () => boolean,
}

/** Available before the async factory runs. `signal` cancels construction only;
 * use pageStatus.fetchSignal() for resources that can resume after retention.
 * Register Solid cleanup synchronously, before awaiting application work.
 * Arbitrary promises/fetches are not automatically cancelled: pass the signal
 * to signal-aware loaders and handle their aborts. */
export type PagePreparationContext = {
  signal: AbortSignal,
  pageStatus: PageStatus,
};

export type StaticPage<UntrackedKeys extends string> = {
  readonly untrackedKeys: ReadonlyArray<UntrackedKeys>,
}

export type Page<
  Output extends object,
  Input extends object = any,
  UntrackedKeys extends (keyof Input & string) = any,
> = {
  readonly render: (untrackedParams: {[K in UntrackedKeys]: Input[K]}, context: PagePreparationContext) => Promise<(
    (reactiveParams: {[K in Exclude<keyof Input, UntrackedKeys>]: Input[K]}, pageStatus: PageStatus) => (
      {html: JSX.Element, title: string } & Output
    )
  )>
} & StaticPage<UntrackedKeys>;
