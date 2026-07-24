// Bump whenever a breaking change is made to the JS↔Swift message format.
export const PROTOCOL_VERSION = 1;

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
};

export type VisitProposedMessage = {
  type: 'visitProposed',
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
