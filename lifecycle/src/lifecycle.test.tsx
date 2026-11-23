import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  action, createContext, createEffect, createMemo, createSignal, flush, isPending,
  Errored, Loading, onCleanup, onSettled, until, untrack, useContext,
  type Accessor, type Element as SolidElement,
} from 'solid-js'
import { Portal, render } from '@solidjs/web'
import { Lifecycle, onEnter, onExit, onInOut, useLifecycle, type Direction } from './index.js'

function deferred() {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

const disposers: (() => void)[] = []
function mount(view: () => SolidElement) {
  const host = document.createElement('div')
  document.body.append(host)
  const dispose = render(view, host)
  disposers.push(() => { dispose(); host.remove() })
  return { host, dispose }
}

function settle() {
  return new Promise<void>(resolve => onSettled(resolve))
}

afterEach(async () => {
  for (const dispose of disposers.splice(0)) dispose()
  await settle()
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('lifecycle control flow on Solid 2 client owners + real DOM', () => {
  it('runs handlers after reactive DOM attributes reflect committed presence', async () => {
    const [visible, show] = createSignal(true)
    const gate = deferred()
    const observations: string[] = []
    function Content() {
      const { phase } = useLifecycle()
      let element!: HTMLParagraphElement
      onExit(() => { observations.push(`exit:${element.dataset.phase}`); return gate.promise })
      onInOut(({ direction }) => {
        observations.push(`${direction}:${element.dataset.phase}`)
        return direction === 'out' ? gate.promise : undefined
      })
      return <p ref={element} data-phase={phase()}>content</p>
    }
    const { host } = mount(() => <Lifecycle.Show when={visible()}><Content /></Lifecycle.Show>)
    await settle()
    show(false); flush()
    expect(observations).toContain('exit:exiting')
    expect(observations).toContain('out:exiting')
    show(true); flush()
    expect(observations.at(-1)).toBe('in:present')
    gate.resolve(); await settle()
    expect(host.textContent).toBe('content')
  })

  it('commits presence to the DOM before dispatching work already woken by a completion', async () => {
    const [visible, show] = createSignal(true)
    const enter = deferred()
    const calls: string[] = []
    function Content() {
      const { phase } = useLifecycle()
      let element!: HTMLParagraphElement
      onInOut(({ direction }) => {
        calls.push(`${direction}:${element.inert}`)
        if (direction === 'in') return enter.promise
      })
      return <p ref={element} inert={phase() === 'exiting'} />
    }
    mount(() => <Lifecycle.Show when={visible()}><Content /></Lifecycle.Show>)
    await settle()
    enter.resolve(); await enter.promise
    show(false); await settle()
    expect(calls).toEqual(['in:false', 'out:true'])
  })

  it('admits a phase-dependent exit before pruning a just-completed entry', async () => {
    const [visible, show] = createSignal(true)
    const enter = deferred(), exit = deferred()
    function Child() { onExit(() => exit.promise); return <b>exiting</b> }
    function Content() {
      const { phase } = useLifecycle()
      onEnter(() => enter.promise)
      return <>{phase() === 'exiting' && <Child />}</>
    }
    const { host } = mount(() => <Lifecycle.Show when={visible()}><Content /></Lifecycle.Show>)
    await settle()
    enter.resolve(); await enter.promise
    show(false); await settle()
    expect(host.textContent).toBe('exiting')
    exit.resolve(); await settle()
    expect(host.textContent).toBe('')
  })

  it('finishes all superseded abort cleanup before applying any new transition targets', async () => {
    const [visible, show] = createSignal(true)
    const gate = deferred()
    const events: string[] = []
    function Content() {
      for (const name of ['a', 'b']) onInOut(({ direction, signal }) => {
        events.push(`${name}:${direction}`)
        signal.addEventListener('abort', () => { events.push(`abort:${name}`) }, { once: true })
        return gate.promise
      })
      return <p>content</p>
    }
    mount(() => <Lifecycle.Show when={visible()}><Content /></Lifecycle.Show>)
    await settle()
    events.length = 0
    show(false); flush()
    expect(events).toEqual(['abort:a', 'abort:b', 'a:out', 'b:out'])
    events.length = 0
    show(true); flush()
    expect(events).toEqual(['abort:a', 'abort:b', 'a:in', 'b:in'])
    gate.resolve(); await settle()
  })

  it('prepares an enter synchronously on the detached element, then runs with connected refs', async () => {
    const gate = deferred()
    const observations: string[] = []
    const [started, setStarted] = createSignal(false)
    function Content() {
      const enter = onEnter<HTMLDivElement>({
        prepare(element) {
          observations.push(`prepare:${element.isConnected}`)
          element.style.opacity = '0'
        },
        run({ element }) {
          observations.push(`run:${element.isConnected}:${element.style.opacity}`)
          setStarted(true)
          return gate.promise
        },
      })
      return <div ref={enter}>prepared</div>
    }
    const { host } = mount(() => <Lifecycle.Show when={true}><Content /></Lifecycle.Show>)
    expect(host.firstElementChild!.getAttribute('style')).toBe('opacity: 0;')
    await until(started, { timeout: 1000 })
    expect(observations).toEqual(['prepare:false', 'run:true:0'])
    gate.resolve(); await settle()
  })

  it('waits for an initial Loading-held render to commit before entering', async () => {
    const load = deferred()
    const calls: boolean[] = []
    function Content() {
      let element!: HTMLParagraphElement
      const value = createMemo(() => load.promise.then(() => 'loaded'))
      onEnter(() => { calls.push(element.isConnected) })
      return <p ref={element}>{value()}</p>
    }
    const { host } = mount(() => <Loading fallback={<span>loading</span>}>
      <Lifecycle.Show when={true}><Content /></Lifecycle.Show>
    </Loading>)
    try {
      await settle()
      expect(host.textContent).toBe('loading')
      expect(calls).toEqual([])
      load.resolve()
      await vi.waitFor(() => expect(calls).toEqual([true]))
      expect(host.textContent).toBe('loaded')
    } finally {
      load.resolve(); await settle()
    }
  })

  it.each(['enter', 'inout'] as const)('prepares %s before insertion but waits for an inner Loading commit to run', async kind => {
    const load = deferred()
    const calls: string[] = []
    function Content() {
      const value = createMemo(() => load.promise.then(() => 'loaded'))
      const hook = kind === 'enter' ? onEnter : onInOut
      const motion = hook<HTMLParagraphElement>({
        prepare(element) {
          calls.push(`prepare:${element.isConnected}`)
          element.style.opacity = '0'
        },
        run({ element, direction }) {
          calls.push(`${direction}:${element.isConnected}:${element.style.opacity}`)
        },
      })
      return <p ref={motion}>{value()}</p>
    }
    const { host } = mount(() => <Lifecycle.Show when={true}>
      <Loading fallback={<span>loading</span>}><Content /></Loading>
    </Lifecycle.Show>)
    try {
      await settle()
      expect(host.textContent).toBe('loading')
      expect(calls).toEqual(['prepare:false'])
      load.resolve()
      await vi.waitFor(() => expect(calls).toEqual(['prepare:false', 'in:true:0']))
      expect(host.textContent).toBe('loaded')
    } finally { load.resolve(); await settle() }
  })

  it('does not let uncommitted hooks block committed work or removal of their boundary', async () => {
    const [visible, show] = createSignal(true)
    const load = deferred(), exit = deferred()
    const child = vi.fn()
    const parentEnter = vi.fn(), parentExit = vi.fn(() => exit.promise)
    function Content() {
      const value = createMemo(() => load.promise.then(() => 'loaded'))
      onEnter(child); onInOut(child); onExit(child)
      return <p>{value()}</p>
    }
    function Parent() {
      onEnter(parentEnter); onExit(parentExit)
      return <Loading fallback={<span>loading</span>}><Content /></Loading>
    }
    const { host } = mount(() => <Lifecycle.Show when={visible()}><Parent /></Lifecycle.Show>)
    try {
      await settle()
      expect(parentEnter).toHaveBeenCalledOnce()
      expect(child).not.toHaveBeenCalled()
      show(false); await settle()
      expect(parentExit).toHaveBeenCalledOnce()
      expect(host.textContent).toBe('loading')
      exit.resolve()
      await vi.waitFor(() => expect(host.textContent).toBe(''))
      load.resolve(); await settle()
      expect(child).not.toHaveBeenCalled()
    } finally { load.resolve(); exit.resolve(); await settle() }
  })

  it.each([false, true])('uses current presence when an inner Loading commits (reentered: %s)', async reentered => {
    const [visible, show] = createSignal(true)
    const load = deferred(), parentExit = deferred(), childExit = deferred()
    const calls: string[] = []
    function Content() {
      let element!: HTMLParagraphElement
      const value = createMemo(() => load.promise.then(() => 'loaded'))
      onEnter(() => { calls.push(`enter:${element.isConnected}`) })
      onExit(() => { calls.push(`exit:${element.isConnected}`); return childExit.promise })
      onInOut(({ direction }) => {
        calls.push(`${direction}:${element.isConnected}`)
        return direction === 'out' ? childExit.promise : undefined
      })
      return <p ref={element}>{value()}</p>
    }
    function Parent() {
      onExit(() => parentExit.promise)
      return <Loading fallback={<span>loading</span>}><Content /></Loading>
    }
    const { host } = mount(() => <Lifecycle.Show when={visible()}><Parent /></Lifecycle.Show>)
    try {
      await settle()
      show(false); await settle()
      if (reentered) { show(true); await settle() }
      expect(calls).toEqual([])
      load.resolve()
      await vi.waitFor(() => expect(calls).toEqual(reentered
        ? ['enter:true', 'in:true'] : ['exit:true', 'out:true']))
      parentExit.resolve(); await settle()
      expect(host.textContent).toBe('loaded')
      childExit.resolve(); await settle()
      expect(host.textContent).toBe(reentered ? 'loaded' : '')
    } finally { load.resolve(); parentExit.resolve(); childExit.resolve(); await settle() }
  })

  it('discards hooks on final unmount before their inner Loading commits', async () => {
    const load = deferred()
    const handler = vi.fn(), cleaned = vi.fn()
    function Content() {
      const value = createMemo(() => load.promise.then(() => 'loaded'))
      onEnter(handler); onInOut(handler); onExit(handler)
      onCleanup(cleaned)
      return <p>{value()}</p>
    }
    const { host, dispose } = mount(() => <Lifecycle.Show when={true}>
      <Loading fallback={<span>loading</span>}><Content /></Loading>
    </Lifecycle.Show>)
    try {
      await settle()
      expect(handler).not.toHaveBeenCalled()
      dispose()
      expect(cleaned).toHaveBeenCalledOnce()
      load.resolve(); await settle()
      expect(host.textContent).toBe('')
      expect(handler).not.toHaveBeenCalled()
    } finally { load.resolve(); await settle() }
  })

  it('admits newly committed hooks before pruning an exit completed in the same turn', async () => {
    const [visible, show] = createSignal(true)
    const [child, showChild] = createSignal(false)
    const parentExit = deferred(), childExit = deferred()
    const calls: boolean[] = []
    function Child() {
      let element!: HTMLParagraphElement
      onExit(() => { calls.push(element.isConnected); return childExit.promise })
      return <p ref={element}>late child</p>
    }
    function Parent() {
      onExit(() => parentExit.promise)
      return <>{child() && <Child />}</>
    }
    const { host } = mount(() => <Lifecycle.Show when={visible()}><Parent /></Lifecycle.Show>)
    show(false); await settle()
    parentExit.resolve(); await parentExit.promise
    showChild(true); await settle()
    expect(calls).toEqual([true])
    expect(host.textContent).toBe('late child')
    childExit.resolve(); await settle()
    expect(host.textContent).toBe('')
  })

  it('starts enter and inout work independently of a pending Loading sibling', async () => {
    const load = deferred()
    const calls: string[] = []
    function Content() {
      let element!: HTMLParagraphElement
      onEnter(() => { calls.push(`enter:${element.isConnected}`) })
      onInOut(({ direction }) => { calls.push(`${direction}:${element.isConnected}`) })
      return <p ref={element}>content</p>
    }
    function Data() {
      const value = createMemo(() => load.promise.then(() => 'loaded'))
      return <span>{value()}</span>
    }
    const { host } = mount(() => <>
      <Lifecycle.Show when={true}><Content /></Lifecycle.Show>
      <Loading fallback={<span>loading</span>}><Data /></Loading>
    </>)
    try {
      await vi.waitFor(() => expect(calls).toEqual(['enter:true', 'in:true']))
      expect(host.querySelector('span')!.textContent).toBe('loading')
    } finally {
      load.resolve(); await settle()
    }
  })

  it('does not hold a synchronous enter open across committed direction changes', () => {
    const [visible, show] = createSignal(true)
    const exit = deferred(), events: string[] = []
    function Content() {
      onEnter(() => { events.push('in') })
      onExit(() => { events.push('out'); return exit.promise })
      return <p>content</p>
    }
    mount(() => <Lifecycle.Show when={visible()}><Content /></Lifecycle.Show>)
    show(false); flush(); show(true); flush()
    expect(events).toEqual(['in', 'out', 'in'])
    exit.resolve()
  })

  it('finishes all standalone enters before starting an ordinary exit', async () => {
    const [visible, show] = createSignal(true)
    const first = deferred(), second = deferred(), exit = deferred()
    const signals: AbortSignal[] = []
    let enters = 0, exits = 0
    function Content() {
      // Registration order must not change sequencing.
      onExit(() => { exits++; return exit.promise })
      onEnter(({ signal }) => { signals.push(signal); enters++; return first.promise })
      onEnter(() => { enters++; return second.promise })
      return <p>content</p>
    }
    const { host } = mount(() => <Lifecycle.Show when={visible()}><Content /></Lifecycle.Show>)
    await vi.waitFor(() => expect(enters).toBe(2))
    show(false); flush()
    expect(signals[0]!.aborted).toBe(false)
    expect(exits).toBe(0)
    first.resolve(); await settle()
    expect(exits).toBe(0)
    second.resolve()
    await vi.waitFor(() => expect(exits).toBe(1))
    expect(host.textContent).toBe('content')
    exit.resolve(); await settle()
    expect(host.textContent).toBe('')
  })

  it('cancels queued removal without restarting an enter, then enters again after aborting an exit', async () => {
    const [visible, show] = createSignal(true)
    const enter = deferred(), exit = deferred()
    let enters = 0, exits = 0, mounts = 0
    const events: string[] = []
    let exitSignal!: AbortSignal
    function Content() {
      mounts++
      onEnter(() => { events.push('enter'); enters++; return enter.promise })
      onExit(({ signal }) => {
        events.push('exit')
        signal.addEventListener('abort', () => { events.push('abort') }, { once: true })
        exitSignal = signal; exits++; return exit.promise
      })
      return <input />
    }
    const { host } = mount(() => <Lifecycle.Show when={visible()}><Content /></Lifecycle.Show>)
    const input = host.querySelector('input')!
    input.value = 'retained'
    await vi.waitFor(() => expect(enters).toBe(1))
    show(false); flush(); show(true); flush()
    expect(enters).toBe(1)
    enter.resolve(); await settle()
    expect(exits).toBe(0)
    show(false); flush()
    expect(exits).toBe(1)
    show(true); flush()
    expect(exitSignal.aborted).toBe(true)
    expect(enters).toBe(2)
    expect(events).toEqual(['enter', 'exit', 'abort', 'enter'])
    exit.resolve(); await settle()
    expect(host.querySelector('input')).toBe(input)
    expect(input.value).toBe('retained')
    expect(mounts).toBe(1)
  })

  it('unregisters pending enter work when its owner is removed by ordinary control flow', async () => {
    const [visible, show] = createSignal(true)
    const [child, showChild] = createSignal(true)
    const gate = deferred()
    let signal!: AbortSignal
    const exit = vi.fn()
    function Child() {
      onEnter(context => { signal = context.signal; return gate.promise })
      return <p>child</p>
    }
    function Parent() {
      onExit(exit)
      return <>{child() && <Child />}</>
    }
    const { host } = mount(() => <Lifecycle.Show when={visible()}><Parent /></Lifecycle.Show>)
    await vi.waitFor(() => expect(signal).toBeDefined())
    show(false); flush()
    expect(exit).not.toHaveBeenCalled()
    showChild(false); flush()
    expect(signal.aborted).toBe(true)
    expect(exit).toHaveBeenCalledOnce()
    gate.resolve(); await settle()
    expect(host.textContent).toBe('')
  })

  it('reconciles same-turn reentry before starting an exit queued behind an enter', async () => {
    const [visible, show] = createSignal(true)
    const enter = deferred()
    let started = false, exits = 0
    function Content() {
      onEnter(() => { started = true; return enter.promise })
      onExit(() => { exits++ })
      return <p>content</p>
    }
    const { host } = mount(() => <Lifecycle.Show when={visible()}><Content /></Lifecycle.Show>)
    await vi.waitFor(() => expect(started).toBe(true))
    show(false); await settle()
    enter.resolve(); await enter.promise
    show(true); await settle()
    expect(exits).toBe(0)
    expect(host.textContent).toBe('content')
  })

  it('reverses inout immediately and ignores stale completions across repeated direction changes', async () => {
    const [visible, show] = createSignal(true)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const runs: { direction: Direction; signal: AbortSignal; gate: ReturnType<typeof deferred> }[] = []
    let mounts = 0, preparations = 0
    function Content() {
      mounts++
      const motion = onInOut<HTMLInputElement>({
        prepare(element, { direction }) { preparations++; element.dataset.direction = direction },
        run({ element, direction, signal }) {
          element.dataset.direction = direction
          const gate = deferred()
          runs.push({ direction, signal, gate })
          return gate.promise
        },
      })
      return <input ref={motion} />
    }
    const { host } = mount(() => <Lifecycle.Show when={visible()}><Content /></Lifecycle.Show>)
    const input = host.querySelector('input')!
    input.value = 'keep me'
    await vi.waitFor(() => expect(runs).toHaveLength(1))
    for (let i = 0; i < 3; i++) {
      show(false); flush()
      expect(input.dataset.direction).toBe('out')
      show(true); flush()
      expect(input.dataset.direction).toBe('in')
    }
    show(false); flush()
    expect(runs.map(run => run.direction)).toEqual(['in', 'out', 'in', 'out', 'in', 'out', 'in', 'out'])
    expect(runs.slice(0, -1).every(run => run.signal.aborted)).toBe(true)
    for (const [index, run] of runs.slice(0, -1).entries()) {
      if (index % 2) run.gate.reject(new Error('superseded'))
      else run.gate.resolve()
    }
    await settle()
    expect(host.querySelector('input')).toBe(input)
    expect(input.value).toBe('keep me')
    expect(mounts).toBe(1)
    expect(preparations).toBe(1)
    expect(errors).not.toHaveBeenCalled()
    runs.at(-1)!.gate.resolve(); await settle()
    expect(host.textContent).toBe('')
  })

  it('does not let standalone enters block inout reversal when both nested flows change', async () => {
    const [visible, show] = createSignal(true)
    const enter = deferred(), exit = deferred(), motionExit = deferred()
    const directions: string[] = []
    let started = false, exits = 0
    function Child() {
      onInOut(({ direction }) => { directions.push(`child:${direction}`); return direction === 'out' ? motionExit.promise : undefined })
      return <b>child</b>
    }
    function Parent() {
      onEnter(() => { started = true; return enter.promise })
      onExit(() => { exits++; return exit.promise })
      onInOut(({ direction }) => { directions.push(`parent:${direction}`); return direction === 'out' ? motionExit.promise : undefined })
      return <section><Lifecycle.Show when={visible()}><Child /></Lifecycle.Show></section>
    }
    const { host } = mount(() => <Lifecycle.Show when={visible()}><Parent /></Lifecycle.Show>)
    await vi.waitFor(() => {
      expect(started).toBe(true)
      expect(directions).toHaveLength(2)
    })
    show(false); flush()
    expect(directions.slice(-2)).toEqual(['parent:out', 'child:out'])
    expect(exits).toBe(0)
    motionExit.resolve(); await settle()
    expect(host.querySelector('section')).not.toBeNull()
    expect(host.querySelector('b')).toBeNull()
    enter.resolve()
    await vi.waitFor(() => expect(exits).toBe(1))
    exit.resolve(); await settle()
    expect(host.textContent).toBe('')
  })

  it('enters new nested branches normally during an ancestor exit without delaying its disposal', async () => {
    const [visible, show] = createSignal(true)
    const [child, showChild] = createSignal(false)
    const parentExit = deferred(), childWork = deferred()
    const entering = vi.fn(), exiting = vi.fn()
    const directions: string[] = []
    let signal!: AbortSignal, parentPhase!: Accessor<string>
    function Child() {
      const enter = onEnter<HTMLDivElement>({ prepare: entering, run: entering })
      const motion = onInOut<HTMLDivElement>({
        prepare(element, { direction }) { directions.push(`prepare:${direction}:${element.isConnected}`) },
        run(context) {
          signal = context.signal
          directions.push(`run:${context.direction}:${context.element.isConnected}`)
          return childWork.promise
        },
      })
      onExit(exiting)
      return <div ref={element => { enter(element); motion(element) }}>late child</div>
    }
    function Parent() {
      parentPhase = useLifecycle().phase
      onExit(() => parentExit.promise)
      return <Lifecycle.Show when={child()}><Child /></Lifecycle.Show>
    }
    const { host } = mount(() => <Lifecycle.Show when={visible()}><Parent /></Lifecycle.Show>)
    show(false); flush()
    showChild(true); await settle()
    expect(entering).toHaveBeenCalledTimes(2)
    expect(directions).toEqual(['prepare:in:false', 'run:in:true'])
    expect(host.textContent).toBe('late child')
    parentExit.resolve()
    await until(() => parentPhase() === 'disposed', { timeout: 1000 })
    expect(host.textContent).toBe('')
    expect(signal.aborted).toBe(true)
    expect(exiting).not.toHaveBeenCalled()
    childWork.resolve(); await settle()
    expect(directions).toHaveLength(2)
  })

  it('aborts enter and inout on final unmount without starting exits', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const enter = deferred(), motion = deferred()
    const signals: AbortSignal[] = []
    const exit = vi.fn()
    function Content() {
      onEnter(({ signal }) => { signals.push(signal); return enter.promise })
      onInOut(({ signal }) => { signals.push(signal); return motion.promise })
      onExit(exit)
      return <p>content</p>
    }
    const { dispose } = mount(() => <Lifecycle.Show when={true}><Content /></Lifecycle.Show>)
    await vi.waitFor(() => expect(signals).toHaveLength(2))
    dispose()
    expect(signals.every(signal => signal.aborted)).toBe(true)
    expect(exit).not.toHaveBeenCalled()
    enter.reject(new Error('disposed')); motion.reject(new Error('disposed')); await settle()
    expect(errors).not.toHaveBeenCalled()
  })

  it('releases retention after failed enter and inout handlers', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const [visible, show] = createSignal(true)
    const exit = vi.fn()
    function Content() {
      onEnter(() => { throw new Error('enter') })
      onInOut(() => Promise.reject(new Error('inout')))
      onExit(exit)
      return <p>content</p>
    }
    const { host } = mount(() => <Lifecycle.Show when={visible()}><Content /></Lifecycle.Show>)
    await settle()
    show(false); await settle()
    expect(exit).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(host.textContent).toBe(''))
    expect(errors).toHaveBeenCalledTimes(3)
  })

  it('keeps owners, effects, context and event handlers alive until all hooks in the boundary finish', async () => {
    const [visible, show] = createSignal(true)
    const [tick, setTick] = createSignal(0)
    const one = deferred(), two = deferred()
    const Context = createContext('default')
    const observations: number[] = []
    let cleaned = 0
    let seenContext = ''
    function Child() {
      const [clicks, setClicks] = createSignal(0)
      const lifecycle = useLifecycle()
      const contextValue = useContext(Context)
      onExit(() => { seenContext = contextValue; return one.promise })
      createEffect(tick, value => { observations.push(value) })
      onCleanup(() => { cleaned++ })
      return <button data-phase={lifecycle.phase()} onClick={() => setClicks(v => v + 1)}>{tick()}:{clicks()}</button>
    }
    function Sibling() {
      onExit(() => two.promise)
      return <span>second</span>
    }
    const { host } = mount(() => <Context value="provided"><Lifecycle.Show when={visible()}><Child /><Sibling /></Lifecycle.Show></Context>)
    const button = host.querySelector('button')!
    expect(button.textContent).toBe('0:0')
    show(false); flush()
    expect(button.dataset.phase).toBe('exiting')
    expect(seenContext).toBe('provided')
    setTick(7); button.click(); flush()
    expect(button.textContent).toBe('7:1')
    expect(observations).toContain(7)
    expect(cleaned).toBe(0)
    one.resolve(); await settle()
    expect(host.contains(button)).toBe(true)
    two.resolve(); await settle()
    expect(host.textContent).toBe('')
    expect(cleaned).toBe(1)
    setTick(8); flush()
    expect(observations).not.toContain(8)
  })

  it('allows exit callbacks to update local and external signals without ownedWrite', async () => {
    const [visible, show] = createSignal(true)
    const [started, setStarted] = createSignal(false)
    const gate = deferred()
    function Content() {
      const [count, setCount] = createSignal(0)
      onExit(() => { setStarted(true); setCount(value => value + 1); return gate.promise })
      return <p>count:{count()}</p>
    }
    const { host } = mount(() => <Lifecycle.Show when={visible()}><Content /></Lifecycle.Show>)
    show(false); flush()
    expect(started()).toBe(true)
    expect(host.textContent).toBe('count:1')
    gate.resolve(); await settle()
    expect(host.textContent).toBe('')
  })

  it('reorders by key, updates item/index accessors, and reuses local state on reentry', async () => {
    const [items, setItems] = createSignal([{ id: 1, name: 'one' }, { id: 2, name: 'two' }])
    const exits = new Map<number, ReturnType<typeof deferred>>()
    const signals = new Map<number, AbortSignal>()
    let mounts = 0
    const { host } = mount(() => <Lifecycle.For each={items()} by={item => item.id}>{(item, index) => {
      mounts++
      const [clicks, setClicks] = createSignal(0)
      onExit(({ signal }) => {
        const gate = deferred()
        exits.set(item().id, gate); signals.set(item().id, signal)
        return gate.promise
      })
      return <button data-id={item().id} onClick={() => setClicks(v => v + 1)}>{item().name}:{index()}:{clicks()}</button>
    }}</Lifecycle.For>)
    const one = host.querySelector('[data-id="1"]') as HTMLButtonElement
    const two = host.querySelector('[data-id="2"]')!
    one.click(); flush()
    setItems([{ id: 2, name: 'TWO' }]); flush()
    expect(host.firstElementChild).toBe(one)
    setItems([{ id: 2, name: 'TWO' }, { id: 1, name: 'ONE' }]); flush()
    expect(signals.get(1)?.aborted).toBe(true)
    expect(host.firstElementChild).toBe(two)
    expect(host.lastElementChild).toBe(one)
    expect(one.textContent).toBe('ONE:1:1')
    expect(mounts).toBe(2)
    exits.get(1)!.resolve(); await settle()
    expect(host.contains(one)).toBe(true)
    setItems([{ id: 1, name: 'ONE' }, { id: 2, name: 'TWO' }]); flush()
    expect(host.firstElementChild).toBe(one)
    expect(one.textContent).toBe('ONE:0:1')
    setItems([]); flush()
    exits.get(2)!.resolve(); await settle()
    expect(host.contains(two)).toBe(false)
    expect(host.contains(one)).toBe(true)
    exits.get(1)!.resolve(); await settle()
    expect(host.children.length).toBe(0)
  })

  it('rejects duplicate keys before mounting any rows', async () => {
    const row = vi.fn(() => <p>row</p>)
    const { host } = mount(() => <Errored fallback={error => <p>{String(error())}</p>}>
      <Lifecycle.For each={[{ id: 1 }, { id: 1 }]} by={item => item.id}>{row}</Lifecycle.For>
    </Errored>)
    await settle()
    expect(host.textContent).toContain('Lifecycle.For requires unique keys')
    expect(row).not.toHaveBeenCalled()
  })

  it('retains function-valued items and creates a new instance only after removal completes', async () => {
    const first = () => 'first', second = () => 'second'
    const [items, setItems] = createSignal([first])
    const exit = deferred()
    let mounts = 0
    const { host } = mount(() => <Lifecycle.For each={items()} by={() => 'key'}>{item => {
      mounts++
      onExit(() => exit.promise)
      return <p>{item()()}</p>
    }}</Lifecycle.For>)
    const element = host.firstElementChild
    setItems([second]); await settle()
    expect(host.textContent).toBe('second')
    expect(host.firstElementChild).toBe(element)
    setItems([]); await settle()
    expect(host.textContent).toBe('second')
    exit.resolve(); await settle()
    expect(host.textContent).toBe('')
    setItems([first]); await settle()
    expect(host.textContent).toBe('first')
    expect(host.firstElementChild).not.toBe(element)
    expect(mounts).toBe(2)
  })

  it('keeps exits in their rendered slots, including during insertions and reorders', async () => {
    const [items, setItems] = createSignal(['a', 'b', 'c', 'd', 'e'])
    const exits = new Map<string, ReturnType<typeof deferred>>()
    const { host } = mount(() => <Lifecycle.For each={items()}>{item => {
      const key = item()
      const gate = deferred()
      exits.set(key, gate)
      onExit(() => gate.promise)
      return <p data-id={key}>{key}</p>
    }}</Lifecycle.For>)
    const rows = () => [...host.children].map(element => element.getAttribute('data-id'))
    const b = host.children[1], d = host.children[3]
    const mutations: MutationRecord[] = []
    const observer = new MutationObserver(records => mutations.push(...records))
    observer.observe(host, { childList: true })
    try {
      setItems(['a', 'c', 'e']); await settle()
      expect(rows()).toEqual(['a', 'b', 'c', 'd', 'e'])
      expect(mutations).toEqual([]) // removals alone must not move any DOM
      setItems(['e', 'x', 'a', 'c']); await settle()
      expect(rows()).toEqual(['e', 'b', 'x', 'd', 'a', 'c'])
      expect(host.children[1]).toBe(b)
      expect(host.children[3]).toBe(d)
      exits.get('b')!.resolve()
      await vi.waitFor(() => expect(rows()).toEqual(['e', 'x', 'd', 'a', 'c']))
      setItems(['a', 'x', 'e']); await settle()
      expect(rows()).toEqual(['a', 'x', 'd', 'e', 'c'])
      expect(host.children[2]).toBe(d)
      exits.get('d')!.resolve(); exits.get('c')!.resolve()
      await vi.waitFor(() => expect(rows()).toEqual(['a', 'x', 'e']))
    } finally {
      observer.disconnect()
    }
  })

  it('lets Solid schedule promise completion without any manual flush', async () => {
    const [visible, show] = createSignal(true)
    const gate = deferred()
    let phase!: Accessor<string>
    let cleaned = 0
    function Content() {
      phase = useLifecycle().phase
      onExit(() => gate.promise)
      onCleanup(() => { cleaned++ })
      return <p>retained</p>
    }
    const { host } = mount(() => <Lifecycle.Show when={visible()}><Content /></Lifecycle.Show>)
    show(false)
    await until(() => phase() === 'exiting', { timeout: 1000 })
    expect(host.textContent).toBe('retained')
    gate.resolve()
    await until(() => phase() === 'disposed', { timeout: 1000 })
    expect(host.textContent).toBe('')
    expect(cleaned).toBe(1)
  })

  it('reconciles same-turn reentry before pruning an exit whose promise just settled', async () => {
    const [visible, show] = createSignal(true)
    const gate = deferred()
    let phase!: Accessor<string>
    let signal!: AbortSignal
    let mounts = 0, cleaned = 0
    function Content() {
      mounts++
      phase = useLifecycle().phase
      onExit(context => { signal = context.signal; return gate.promise })
      onCleanup(() => { cleaned++ })
      return <input />
    }
    const { host } = mount(() => <Lifecycle.Show when={visible()}><Content /></Lifecycle.Show>)
    const input = host.querySelector('input')!
    input.value = 'preserve me'
    show(false)
    await until(() => phase() === 'exiting', { timeout: 1000 })
    gate.resolve()
    // Let the registered completion run first, then reenter in this promise turn.
    // A separate pruning microtask can race the source's native render flush here.
    await gate.promise
    show(true)
    await until(() => phase() === 'present', { timeout: 1000 })
    expect(signal.aborted).toBe(true)
    expect(host.querySelector('input')).toBe(input)
    expect(input.value).toBe('preserve me')
    expect(mounts).toBe(1)
    expect(cleaned).toBe(0)
  })

  it('does not start exits for an action-held removal before its render commits', async () => {
    const [visible, show] = createSignal(true)
    const commit = deferred(), exit = deferred()
    let phase!: Accessor<string>
    let exits = 0
    function Content() {
      phase = useLifecycle().phase
      onExit(() => { exits++; return exit.promise })
      return <p>content</p>
    }
    const { host } = mount(() => <Lifecycle.Show when={visible()}><Content /></Lifecycle.Show>)
    const remove = action(function* () { show(false); yield commit.promise })
    const pending = remove()
    try {
      await vi.waitFor(() => expect(isPending(visible)).toBe(true))
      expect(exits).toBe(0)
      expect(phase()).toBe('present')
      expect(host.textContent).toBe('content')
      commit.resolve(); await pending
      await until(() => phase() === 'exiting', { timeout: 1000 })
      expect(exits).toBe(1)
      expect(host.textContent).toBe('content')
      exit.resolve()
      await until(() => phase() === 'disposed', { timeout: 1000 })
      expect(host.textContent).toBe('')
    } finally {
      commit.resolve(); exit.resolve(); await pending
    }
  })

  it('does not let an unrelated Loading boundary strand a completed exit', async () => {
    const [visible, show] = createSignal(true)
    const load = deferred(), exit = deferred()
    let phase!: Accessor<string>
    function Content() {
      phase = useLifecycle().phase
      onExit(() => exit.promise)
      return <p id="retained">content</p>
    }
    function Data() {
      const value = createMemo(() => load.promise.then(() => 'loaded'))
      return <span>{value()}</span>
    }
    const { host } = mount(() => <>
      <Lifecycle.Show when={visible()}><Content /></Lifecycle.Show>
      <Loading fallback={<span>loading</span>}><Data /></Loading>
    </>)
    try {
      expect(host.querySelector('span')!.textContent).toBe('loading')
      show(false)
      await until(() => phase() === 'exiting', { timeout: 1000 })
      exit.resolve()
      await until(() => phase() === 'disposed', { timeout: 1000 })
      expect(host.querySelector('#retained')).toBeNull()
      expect(host.querySelector('span')).not.toBeNull()
    } finally {
      load.resolve(); exit.resolve()
    }
  })

  it('disposes deeply nested flows without propagating exits or manually flushing', async () => {
    const [visible, show] = createSignal(true)
    const gate = deferred()
    const leafExit = vi.fn()
    let parentPhase!: Accessor<string>, leafPhase!: Accessor<string>
    let cleanups = 0
    function Nested(props: { depth: number }): SolidElement {
      onCleanup(() => { cleanups++ })
      if (props.depth === 24) {
        parentPhase = useLifecycle().phase
        onExit(() => gate.promise)
      }
      if (props.depth === 0) {
        leafPhase = useLifecycle().phase
        onExit(leafExit)
        return <p>leaf</p>
      }
      return <Lifecycle.Show when={true}><Nested depth={props.depth - 1} /></Lifecycle.Show>
    }
    const { host } = mount(() => <Lifecycle.Show when={visible()}><Nested depth={24} /></Lifecycle.Show>)
    show(false)
    await until(() => parentPhase() === 'exiting', { timeout: 1000 })
    expect(leafPhase()).toBe('present')
    expect(host.textContent).toBe('leaf')
    gate.resolve()
    await until(() => leafPhase() === 'disposed', { timeout: 1000 })
    expect(host.textContent).toBe('')
    expect(cleanups).toBe(25)
    expect(leafExit).not.toHaveBeenCalled()
  })

  it('guards stale promises across rapid toggle / cancel / exit cycles', async () => {
    const [visible, show] = createSignal(true)
    const runs: { gate: ReturnType<typeof deferred>; signal: AbortSignal }[] = []
    let mounts = 0, cleaned = 0, aborts = 0
    function Content() {
      mounts++
      onCleanup(() => { cleaned++ })
      onExit(({ signal }) => {
        const gate = deferred()
        signal.addEventListener('abort', () => { aborts++ }, { once: true })
        runs.push({ gate, signal })
        return gate.promise
      })
      return <div>content</div>
    }
    const { host } = mount(() => <Lifecycle.Show when={visible()}><Content /></Lifecycle.Show>)
    const node = host.firstElementChild
    for (let i = 0; i < 5; i++) { show(false); flush(); show(true); flush() }
    expect(aborts).toBe(5)
    show(false); flush()
    for (const run of runs.slice(0, -1)) run.gate.resolve()
    await settle()
    expect(host.firstElementChild).toBe(node)
    expect(cleaned).toBe(0)
    expect(mounts).toBe(1)
    runs.at(-1)!.gate.resolve(); await settle()
    expect(cleaned).toBe(1)
    expect(host.textContent).toBe('')
  })

  it('out-in waits for every outgoing handler and disposal before mounting the next owner', async () => {
    const [page, setPage] = createSignal('a')
    const one = deferred(), two = deferred()
    const events: string[] = []
    function A() {
      onExit(() => one.promise); onExit(() => two.promise)
      onCleanup(() => { events.push('dispose:a') })
      return <p>A</p>
    }
    function B() { events.push('mount:b'); return <p>B</p> }
    const { host } = mount(() => <Lifecycle.Switch mode="out-in">
      <Lifecycle.Match when={page() === 'a'}><A /></Lifecycle.Match>
      <Lifecycle.Match when={page() === 'b'}><B /></Lifecycle.Match>
    </Lifecycle.Switch>)
    setPage('b'); await settle()
    expect(host.textContent).toBe('A')
    expect(events).toEqual([])
    one.resolve(); await settle()
    expect(events).toEqual([])
    two.resolve()
    await vi.waitFor(() => expect(host.textContent).toBe('B'))
    expect(events).toEqual(['dispose:a', 'mount:b'])
  })

  it('out-in does not wait for the cleanup of a branch that was never rendered', async () => {
    const [page, select] = createSignal('a'), [revealed, reveal] = createSignal(false)
    const mounts: string[] = []
    function Branch(props: { name: string }) { mounts.push(props.name); return <p>{props.name}</p> }
    function App() {
      const branches = <Lifecycle.Switch mode="out-in">
        <Lifecycle.Match when={page() === 'a'}><Branch name="a" /></Lifecycle.Match>
        <Lifecycle.Match when={page() === 'b'}><Branch name="b" /></Lifecycle.Match>
      </Lifecycle.Switch>
      return <>{revealed() && branches}</>
    }
    const { host } = mount(App)
    select('b'); await settle()
    expect(mounts).toEqual([])
    reveal(true); await settle()
    expect(host.textContent).toBe('b')
    expect(mounts).toEqual(['b'])
  })

  it('out-in mounts only the latest request, including fallback in both directions', async () => {
    const [page, setPage] = createSignal('a')
    const first = deferred(), fallback = deferred()
    const events: string[] = []
    function A() { onExit(() => first.promise); return <p>A</p> }
    function B() { events.push('B'); return <p>B</p> }
    function Fallback() { events.push('fallback'); onExit(() => fallback.promise); return <p>fallback</p> }
    const { host } = mount(() => <Lifecycle.Switch mode="out-in" fallback={<Fallback />}>
      <Lifecycle.Match when={page() === 'a'}><A /></Lifecycle.Match>
      <Lifecycle.Match when={page() === 'b'}><B /></Lifecycle.Match>
    </Lifecycle.Switch>)
    setPage('b'); await settle()
    setPage('unknown'); await settle()
    expect(events).toEqual([])
    first.resolve()
    await vi.waitFor(() => expect(host.textContent).toBe('fallback'))
    expect(events).toEqual(['fallback'])
    setPage('b'); await settle()
    expect(host.textContent).toBe('fallback')
    fallback.resolve()
    await vi.waitFor(() => expect(host.textContent).toBe('B'))
    expect(events).toEqual(['fallback', 'B'])
  })

  it('out-in reselects an exiting owner without losing state or observing stale completion', async () => {
    const [page, setPage] = createSignal('a')
    const gate = deferred()
    let signal!: AbortSignal, mounts = 0
    const incoming = vi.fn(() => <p>B</p>)
    function A() {
      mounts++
      onExit(context => { signal = context.signal; return gate.promise })
      return <input />
    }
    const { host } = mount(() => <Lifecycle.Switch mode="out-in">
      <Lifecycle.Match when={page() === 'a'}><A /></Lifecycle.Match>
      <Lifecycle.Match when={page() === 'b'}>{incoming}</Lifecycle.Match>
    </Lifecycle.Switch>)
    const input = host.querySelector('input')!
    input.value = 'keep'
    setPage('b'); await settle()
    setPage('a'); await settle()
    expect(signal.aborted).toBe(true)
    gate.resolve(); await settle()
    expect(host.querySelector('input')).toBe(input)
    expect(input.value).toBe('keep')
    expect(mounts).toBe(1)
    expect(incoming).not.toHaveBeenCalled()
  })

  it('out-in honors standalone entry sequencing before waiting for exit', async () => {
    const [page, setPage] = createSignal('a')
    const enter = deferred(), exit = deferred()
    const exiting = vi.fn(() => exit.promise)
    let started = false
    function A() { onEnter(() => { started = true; return enter.promise }); onExit(exiting); return <p>A</p> }
    const { host } = mount(() => <Lifecycle.Switch mode="out-in">
      <Lifecycle.Match when={page() === 'a'}><A /></Lifecycle.Match>
      <Lifecycle.Match when={page() === 'b'}><p>B</p></Lifecycle.Match>
    </Lifecycle.Switch>)
    await vi.waitFor(() => expect(started).toBe(true))
    setPage('b'); await settle()
    expect(exiting).not.toHaveBeenCalled()
    expect(host.textContent).toBe('A')
    enter.resolve()
    await vi.waitFor(() => expect(exiting).toHaveBeenCalledOnce())
    expect(host.textContent).toBe('A')
    exit.resolve()
    await vi.waitFor(() => expect(host.textContent).toBe('B'))
  })

  it('out-in updates same-branch values and handles handler-free branches without timers', async () => {
    const [value, setValue] = createSignal<{ name: string } | false>({ name: 'old' })
    let mounts = 0
    const { host } = mount(() => <Lifecycle.Switch mode="out-in" fallback={<b>fallback</b>}>
      <Lifecycle.Match when={value()}>{item => { mounts++; return <p>{item().name}</p> }}</Lifecycle.Match>
    </Lifecycle.Switch>)
    const original = host.firstElementChild
    setValue({ name: 'new' }); await settle()
    expect(host.firstElementChild).toBe(original)
    expect(host.textContent).toBe('new')
    expect(mounts).toBe(1)
    setValue(false)
    await vi.waitFor(() => expect(host.textContent).toBe('fallback'))
    setValue({ name: 'again' })
    await vi.waitFor(() => expect(host.textContent).toBe('again'))
    expect(mounts).toBe(2)
  })

  it('out-in reconciles same-turn reentry before pruning a completed exit', async () => {
    const [page, setPage] = createSignal('a')
    const gate = deferred()
    let phase!: Accessor<string>
    function A() { phase = useLifecycle().phase; onExit(() => gate.promise); return <input /> }
    const { host } = mount(() => <Lifecycle.Switch mode="out-in">
      <Lifecycle.Match when={page() === 'a'}><A /></Lifecycle.Match>
      <Lifecycle.Match when={page() === 'b'}><p>B</p></Lifecycle.Match>
    </Lifecycle.Switch>)
    const input = host.firstElementChild
    setPage('b')
    await until(() => phase() === 'exiting', { timeout: 1000 })
    gate.resolve(); await gate.promise
    setPage('a')
    await until(() => phase() === 'present', { timeout: 1000 })
    expect(host.firstElementChild).toBe(input)
  })

  it('out-in never mounts pending content after ancestor disposal', async () => {
    const [page, setPage] = createSignal('a')
    const gate = deferred()
    const incoming = vi.fn(() => <p>B</p>)
    let signal!: AbortSignal
    function A() { onExit(context => { signal = context.signal; return gate.promise }); return <p>A</p> }
    const { host, dispose } = mount(() => <Lifecycle.Switch mode="out-in">
      <Lifecycle.Match when={page() === 'a'}><A /></Lifecycle.Match>
      <Lifecycle.Match when={page() === 'b'}>{incoming}</Lifecycle.Match>
    </Lifecycle.Switch>)
    setPage('b'); await settle()
    dispose()
    gate.resolve(); await settle()
    expect(signal.aborted).toBe(true)
    expect(incoming).not.toHaveBeenCalled()
    expect(host.textContent).toBe('')
  })

  it('out-in does not wait for unrelated nested exit work', async () => {
    const [page, setPage] = createSignal('a')
    const [child, showChild] = createSignal(true)
    const gate = deferred()
    let signal!: AbortSignal
    function Child() { onExit(context => { signal = context.signal; return gate.promise }); return <i>child</i> }
    const { host } = mount(() => <Lifecycle.Switch mode="out-in">
      <Lifecycle.Match when={page() === 'a'}><Lifecycle.Show when={child()}><Child /></Lifecycle.Show></Lifecycle.Match>
      <Lifecycle.Match when={page() === 'b'}><p>B</p></Lifecycle.Match>
    </Lifecycle.Switch>)
    showChild(false); await settle()
    setPage('b')
    await vi.waitFor(() => expect(host.textContent).toBe('B'))
    expect(signal.aborted).toBe(true)
    gate.resolve(); await settle()
  })

  it('out-in starts exits only after an action-held selection commits', async () => {
    const [page, setPage] = createSignal('a')
    const commit = deferred(), exit = deferred()
    const exiting = vi.fn(() => exit.promise)
    function A() { onExit(exiting); return <p>A</p> }
    const { host } = mount(() => <Lifecycle.Switch mode="out-in">
      <Lifecycle.Match when={page() === 'a'}><A /></Lifecycle.Match>
      <Lifecycle.Match when={page() === 'b'}><p>B</p></Lifecycle.Match>
    </Lifecycle.Switch>)
    const select = action(function* () { setPage('b'); yield commit.promise })
    const pending = select()
    try {
      await vi.waitFor(() => expect(isPending(page)).toBe(true))
      expect(exiting).not.toHaveBeenCalled()
      expect(host.textContent).toBe('A')
      commit.resolve(); await pending
      await vi.waitFor(() => expect(exiting).toHaveBeenCalledOnce())
      expect(host.textContent).toBe('A')
      exit.resolve()
      await vi.waitFor(() => expect(host.textContent).toBe('B'))
    } finally { commit.resolve(); exit.resolve(); await pending }
  })

  it('out-in releases failed exits and validates its mode', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const [page, setPage] = createSignal('a')
    function A() { onExit(() => Promise.reject(new Error('failed'))); return <p>A</p> }
    const { host } = mount(() => <Lifecycle.Switch mode="out-in">
      <Lifecycle.Match when={page() === 'a'}><A /></Lifecycle.Match>
      <Lifecycle.Match when={page() === 'b'}><p>B</p></Lifecycle.Match>
    </Lifecycle.Switch>)
    setPage('b')
    await vi.waitFor(() => expect(host.textContent).toBe('B'))
    const invalid = mount(() => <Errored fallback={error => <p>{String(error())}</p>}>
      <Lifecycle.Switch mode={'invalid' as 'out-in'}><Lifecycle.Match when={true}><p>invalid</p></Lifecycle.Match></Lifecycle.Switch>
    </Errored>)
    await settle()
    expect(invalid.host.textContent).toContain('Lifecycle mode must be parallel or out-in')
  })

  it('retains Switch and fallback branches, selecting the first matching Match', async () => {
    const [page, setPage] = createSignal('home')
    const gates = { home: deferred(), settings: deferred(), fallback: deferred() }
    let homeMounts = 0
    function Home() { homeMounts++; onExit(() => gates.home.promise); return <div id="home">home</div> }
    function Settings() { onExit(() => gates.settings.promise); return <div id="settings">settings</div> }
    function Fallback() { onExit(() => gates.fallback.promise); return <div id="fallback">fallback</div> }
    const { host } = mount(() => <Lifecycle.Switch fallback={<Fallback />}>
      <Lifecycle.Match when={page() === 'home'}><Home /></Lifecycle.Match>
      <Lifecycle.Match when={page() !== 'none'}><Settings /></Lifecycle.Match>
    </Lifecycle.Switch>)
    const home = host.querySelector('#home')!
    expect(host.querySelector('#settings')).toBeNull()
    setPage('settings'); flush()
    expect(host.querySelector('#home')).toBe(home)
    expect(host.querySelector('#settings')).not.toBeNull()
    setPage('none'); flush()
    expect(host.querySelector('#fallback')).not.toBeNull()
    setPage('home'); flush()
    expect(host.querySelector('#home')).toBe(home)
    expect(homeMounts).toBe(1)
    gates.home.resolve(); gates.settings.resolve(); gates.fallback.resolve(); await settle()
    expect(host.textContent).toBe('home')
  })

  it('tracks direct children and fallback values without remounting the selection', async () => {
    const [selected, select] = createSignal(true), [label, rename] = createSignal('one')
    const { host } = mount(() => <>
      <Lifecycle.Show when={selected()} fallback={`show:${label()}`}>{label()}</Lifecycle.Show>
      <Lifecycle.Switch fallback={`switch:${label()}`}>
        <Lifecycle.Match when={selected()}>{label()}</Lifecycle.Match>
      </Lifecycle.Switch>
    </>)
    rename('two'); await settle()
    expect(host.textContent).toBe('twotwo')
    select(false); await settle()
    rename('three'); await settle()
    expect(host.textContent).toBe('show:threeswitch:three')
  })

  it.each(['Show', 'Match'] as const)('keeps %s values readable through exit and reentry', async control => {
    const [value, setValue] = createSignal<{ name: string } | false>({ name: 'old' })
    const gate = deferred()
    const content = (item: Accessor<{ name: string }>) => {
      onExit(() => gate.promise)
      return <p>{item().name}</p>
    }
    const { host } = mount(() => control === 'Show'
      ? <Lifecycle.Show when={value()}>{content}</Lifecycle.Show>
      : <Lifecycle.Switch><Lifecycle.Match when={value()}>{content}</Lifecycle.Match></Lifecycle.Switch>)
    const element = host.firstElementChild
    setValue(false); flush()
    expect(host.textContent).toBe('old') // not false/undefined during exit
    setValue({ name: 'new' }); flush()
    expect(host.textContent).toBe('new')
    gate.resolve(); await settle()
    expect(host.firstElementChild).toBe(element)
    expect(host.textContent).toBe('new')
  })

  it('leaves nested lifecycles unchanged through parent exit and reentry', async () => {
    const [visible, show] = createSignal(true)
    const parentExit = deferred()
    const entering = vi.fn(), exiting = vi.fn()
    const directions: Direction[] = []
    let childMounts = 0
    let childSignal!: AbortSignal
    function Child() {
      childMounts++
      const phase = useLifecycle().phase
      onEnter(entering)
      onExit(exiting)
      onInOut(({ direction, signal }) => { childSignal = signal; directions.push(direction) })
      return <input data-phase={phase()} />
    }
    function Parent() {
      onExit(() => parentExit.promise)
      return <Lifecycle.Show when={true}><Child /></Lifecycle.Show>
    }
    const { host } = mount(() => <Lifecycle.Show when={visible()}><Parent /></Lifecycle.Show>)
    const input = host.querySelector('input')!
    input.value = 'state worth retaining'
    await settle()
    show(false); await settle()
    expect(input.dataset.phase).toBe('present')
    expect(childSignal.aborted).toBe(false)
    show(true); await settle()
    parentExit.resolve(); await settle()
    expect(host.querySelector('input')).toBe(input)
    expect(input.value).toBe('state worth retaining')
    expect(childMounts).toBe(1)
    expect(entering).toHaveBeenCalledOnce()
    expect(exiting).not.toHaveBeenCalled()
    expect(directions).toEqual(['in'])
    expect(childSignal.aborted).toBe(false)
  })

  it('disposes nested flows immediately when the removed parent has no handlers', async () => {
    const [visible, show] = createSignal(true)
    const work = deferred()
    const exiting = vi.fn()
    const signals: AbortSignal[] = []
    let cleaned = 0
    function Child() {
      onEnter(({ signal }) => { signals.push(signal); return work.promise })
      onInOut(({ signal }) => { signals.push(signal); return work.promise })
      onExit(exiting)
      onCleanup(() => { cleaned++ })
      return <p>nested</p>
    }
    const { host } = mount(() => <Lifecycle.Show when={visible()}><Lifecycle.Show when={true}><Child /></Lifecycle.Show></Lifecycle.Show>)
    await settle()
    expect(signals).toHaveLength(2)
    show(false); await settle()
    expect(host.textContent).toBe('')
    expect(cleaned).toBe(1)
    expect(exiting).not.toHaveBeenCalled()
    expect(signals.every(signal => signal.aborted)).toBe(true)
    work.resolve(); await settle()
  })

  it('removes a child whose own data changes without waiting for an exiting parent', async () => {
    const [parent, setParent] = createSignal(true)
    const [child, setChild] = createSignal(true)
    const parentExit = deferred(), childExit = deferred()
    function Child() { onExit(() => childExit.promise); return <i>child</i> }
    function Parent() { onExit(() => parentExit.promise); return <section><Lifecycle.Show when={child()}><Child /></Lifecycle.Show></section> }
    const { host } = mount(() => <Lifecycle.Show when={parent()}><Parent /></Lifecycle.Show>)
    setParent(false); setChild(false); await settle()
    expect(host.querySelector('i')).not.toBeNull()
    childExit.resolve(); await settle()
    expect(host.querySelector('section')).not.toBeNull()
    expect(host.querySelector('i')).toBeNull()
    setParent(true); await settle()
    expect(host.querySelector('i')).toBeNull()
    parentExit.resolve(); await settle()
  })

  it('aborts an independently exiting child when the parent finishes first', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const [parent, setParent] = createSignal(true)
    const [child, setChild] = createSignal(true)
    const parentExit = deferred(), childExit = deferred()
    let childSignal!: AbortSignal
    let childExits = 0
    function Child() {
      onExit(({ signal }) => { childSignal = signal; childExits++; return childExit.promise })
      return <i>child</i>
    }
    function Parent() { onExit(() => parentExit.promise); return <Lifecycle.Show when={child()}><Child /></Lifecycle.Show> }
    const { host } = mount(() => <Lifecycle.Show when={parent()}><Parent /></Lifecycle.Show>)
    setChild(false); await settle()
    setParent(false); await settle()
    expect(childExits).toBe(1)
    expect(childSignal.aborted).toBe(false)
    parentExit.resolve(); await settle()
    expect(host.textContent).toBe('')
    expect(childSignal.aborted).toBe(true)
    childExit.reject(new Error('disposed')); await settle()
    expect(errors).not.toHaveBeenCalled()
  })

  it('keeps streaming list transitions local while its page exits', async () => {
    const [visible, show] = createSignal(true)
    const [users, setUsers] = createSignal(['alice', 'bob'])
    const pageExit = deferred(), rowWork = deferred()
    const runs: { user: string; direction: Direction; signal: AbortSignal }[] = []
    function User(props: { name: string }) {
      const name = untrack(() => props.name)
      const { phase } = useLifecycle()
      onInOut(({ direction, signal }) => {
        runs.push({ user: name, direction, signal })
        return rowWork.promise
      })
      return <p data-user={props.name} data-phase={phase()}>{props.name}</p>
    }
    function Page() {
      onExit(() => pageExit.promise)
      return <Lifecycle.For each={users()}>{user => <User name={user()} />}</Lifecycle.For>
    }
    const { host } = mount(() => <Lifecycle.Show when={visible()}><Page /></Lifecycle.Show>)
    await settle()
    show(false); await settle()
    expect(runs.map(run => `${run.user}:${run.direction}`)).toEqual(['alice:in', 'bob:in'])
    setUsers(['bob', 'carol']); await settle()
    expect(host.querySelector('[data-user="alice"]')!.getAttribute('data-phase')).toBe('exiting')
    expect(host.querySelector('[data-user="bob"]')!.getAttribute('data-phase')).toBe('present')
    expect(host.querySelector('[data-user="carol"]')!.getAttribute('data-phase')).toBe('present')
    expect(runs.filter(run => run.direction === 'out').map(run => run.user)).toEqual(['alice'])
    expect(runs.filter(run => run.direction === 'in').map(run => run.user)).toEqual(['alice', 'bob', 'carol'])
    pageExit.resolve(); await settle()
    expect(host.textContent).toBe('')
    expect(runs.every(run => run.signal.aborted)).toBe(true)
    rowWork.resolve(); await settle()
  })

  it('includes late hooks registered in the same exiting boundary', async () => {
    const [visible, show] = createSignal(true)
    const [childVisible, showChild] = createSignal(false)
    const parentExit = deferred(), childExit = deferred()
    const entering = vi.fn()
    const connections: boolean[] = []
    function Child() {
      let element!: HTMLParagraphElement
      const enter = onEnter<HTMLParagraphElement>({ prepare: entering, run: entering })
      onExit(() => {
        connections.push(element.isConnected)
        return childExit.promise
      })
      return <p ref={target => { element = target; enter(target) }}>late child</p>
    }
    function Parent() { onExit(() => parentExit.promise); return <>{childVisible() && <Child />}</> }
    const { host } = mount(() => <Lifecycle.Show when={visible()}><Parent /></Lifecycle.Show>)
    show(false); flush()
    showChild(true); await settle()
    expect(connections).toEqual([true])
    expect(entering).not.toHaveBeenCalled()
    parentExit.resolve(); await settle()
    expect(host.textContent).toBe('late child')
    childExit.resolve(); await settle()
    expect(host.textContent).toBe('')
  })

  it('coordinates descendants through ownership even across a Portal', async () => {
    const [visible, show] = createSignal(true)
    const gate = deferred()
    const target = document.createElement('aside')
    document.body.append(target)
    function Child() { onExit(() => gate.promise); return <b>portal child</b> }
    const { host } = mount(() => <Lifecycle.Show when={visible()}><span>parent</span><Portal mount={target}><Child /></Portal></Lifecycle.Show>)
    show(false); flush(); await settle()
    expect(host.textContent).toBe('parent')
    expect(target.textContent).toBe('portal child')
    gate.resolve(); await settle()
    expect(host.textContent).toBe('')
    expect(target.textContent).toBe('')
  })

  it('aborts immediately on final unmount and ignores outstanding completions', async () => {
    const [visible, show] = createSignal(true)
    const gate = deferred()
    let signal!: AbortSignal
    let cleaned = 0, exits = 0
    function Child() {
      onExit(context => { signal = context.signal; exits++; return gate.promise })
      onCleanup(() => { cleaned++ })
      return <p>pending</p>
    }
    const { host, dispose } = mount(() => <Lifecycle.Show when={visible()}><Child /></Lifecycle.Show>)
    show(false); flush()
    dispose()
    expect(signal.aborted).toBe(true)
    expect(cleaned).toBe(1)
    expect(exits).toBe(1)
    expect(host.textContent).toBe('')
    gate.resolve(); await settle()
    expect(host.textContent).toBe('')
    const second = mount(() => <Lifecycle.Show when={true}><Child /></Lifecycle.Show>)
    second.dispose()
    expect(exits).toBe(1) // cleanup does not start an impossible asynchronous exit
  })

  it.each(['return', 'throw', 'reject'] as const)('preserves same-turn reentry from an exit that ends by %s', async failure => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const [visible, show] = createSignal(true)
    let mounts = 0, cleanups = 0
    function Content() {
      mounts++
      onCleanup(() => { cleanups++ })
      onExit(() => {
        show(true)
        if (failure === 'return') return
        const error = new Error('exit failed after requesting reentry')
        if (failure === 'throw') throw error
        return Promise.reject(error)
      })
      return <input />
    }
    const { host } = mount(() => <Lifecycle.Show when={visible()}><Content /></Lifecycle.Show>)
    const input = host.querySelector('input')!
    input.value = 'keep me'
    show(false); await settle()
    expect(host.querySelector('input')).toBe(input)
    expect(input.value).toBe('keep me')
    expect(mounts).toBe(1)
    expect(cleanups).toBe(0)
  })

  it('reports failures but releases retention for rejected and throwing handlers', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const [visible, show] = createSignal(true)
    function Content() {
      onExit(() => { throw new Error('sync') })
      onExit(() => Promise.reject(new Error('async')))
      return <p>failure</p>
    }
    const { host } = mount(() => <Lifecycle.Show when={visible()}><Content /></Lifecycle.Show>)
    show(false); flush(); await settle()
    expect(host.textContent).toBe('')
    expect(errors).toHaveBeenCalledTimes(2)
  })
})
