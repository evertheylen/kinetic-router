// simplest possible code to track state-machine-like state transitions

export function transition<From, To>(from: From, to: Promise<To>): StateTransition<From, To> {
  return { from, to }
}

export type StateTransition<From, To> = {
  from: From,
  to: Promise<To>
}
