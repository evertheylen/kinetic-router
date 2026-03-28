
type State<S, T> = S & { tag: T };
type Untag<S> = Exclude<S, 'tag'>;

export function makeStateMachine<
  const S extends { tag: string },
  const Transitions extends { [key in string]: (state: S, ...args: any[]) => Promise<S> }
>(state: S, transitions: Transitions) {
  const machine = {
    state,
    transitionPromise: undefined as Promise<S> | undefined
    transitionTo()
  };


}


/*
  state: S
  transitionPromise: Promise<S> | undefined = undefined;
  abstract transitions: Transitions;

  transition<Transition extends keyof Transitions>(
    trans: Transition,
    ...args: (Transitions[Transition] extends ((state: S, ...args: (infer Args extends any[])) => Promise<any>) ? Args : never )
  ) {
    // TODO block transitions while another is running?
    this.transitionPromise = this.transitions[trans](this.state, ...args).then(s => {
      this.state = s;
      return s;
    });
  }

  constructor(state: S) {
    this.state = state;
  }
}
