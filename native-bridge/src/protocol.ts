// Bump whenever a breaking change is made to the JS↔Swift message format.
export const PROTOCOL_VERSION = 2;

export type NativePresentation = 'push' | 'modal';

export type NativeStaticData = {
  native?: {
    presentation?: NativePresentation,
    tag?: string,
  },
};

export type ReadyMessage = {
  type: 'ready',
  protocolVersion: number,
  bundleVersion?: string,
  url: string,
  /** JS-minted id of the entry that is current at handshake time. The shell
   * adopts this id for its initial entry — no initial render round-trip is
   * needed; the router renders the initial page on its own. */
  initialEntryId: string,
};

export type VisitProposedMessage = {
  type: 'visitProposed',
  /** Correlates this proposal with a later `render` call. The shell echoes
   * it as the fourth `render` argument when (and only when) that render is
   * the answer to this proposal. Proposals the shell ignores are cleaned up
   * by the engine when an unrelated render arrives. */
  proposalId: string,
  url: string,
  state: unknown,
  action: 'push' | 'replace',
  routePattern?: string,
  native?: NativeStaticData['native'],
};

export type RenderCompletedMessage = {
  type: 'renderCompleted',
  entryId: string,
  title: string,
};

export type RenderFailedMessage = {
  type: 'renderFailed',
  entryId: string,
  error: string,
};

export type TitleChangedMessage = {
  type: 'titleChanged',
  entryId: string,
  title: string,
};

export type StateUpdatedMessage = {
  type: 'stateUpdated',
  entryId: string,
  state: unknown,
  /** Present when the entry's URL also changed (the router's initial URL
   * normalization replaces in place). The shell updates its entry table. */
  url?: string,
};

export type ExternalUrlMessage = {
  type: 'externalUrl',
  url: string,
};

export type JsToSwiftMessage =
  | ReadyMessage
  | VisitProposedMessage
  | RenderCompletedMessage
  | RenderFailedMessage
  | TitleChangedMessage
  | StateUpdatedMessage
  | ExternalUrlMessage;

export type SetStackEntry = {
  entryId: string,
  url: string,
  state: unknown,
};
