import type { JSX } from "@solidjs/web";

/** Reactive lifecycle accessors, not an automatic resource/freshness policy.
 * Backstage output can fetch while invisible and unfocused. Gate autofocus,
 * analytics, and other activation-only effects on visibility or page focus.
 * In dumb SSR, fetching lasts only for the one-shot render; visibility, focus
 * and animation are always false. See dumb-ssr.ts for the server contract. */
export type PageStatus = {
  /** True while preparing, visible, or requested by a preparation consumer.
   * Unrequested retained pages stop fetching; disposal ends every request. */
  shouldFetch: () => boolean,

  /** Non-aborted during the current fetch-active period, undefined while idle.
   * Aborted when fetching ends; resumption supplies a fresh signal. Track this
   * accessor in reactive resource code and pass the signal to your loaders. */
  fetchSignal: () => AbortSignal | undefined,

  /** True for the active page stack, including its ancestor layouts. Gate
   * external portals and native modal dialogs with this accessor (for example,
   * mount them inside a Show). A dialog opened with showModal() escapes even an
   * inert ancestor and otherwise blocks interaction with the incoming page. */
  isVisible: () => boolean,

  /** Reserved; always false. Outlet motion does not drive page status or delay
   * navigation.finished. The Navigation API's transition tracks rendering. */
  isAnimating: () => boolean,

  /** True only for the active leaf page, not its ancestor layouts. */
  hasFocus: () => boolean,
}

/** Available before the async factory runs. `signal` cancels construction only;
 * use pageStatus.fetchSignal() for resources that can resume after retention.
 * Dumb SSR uses a single render lifetime for both signals.
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
