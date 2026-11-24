import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, createSignal, flush, onSettled } from 'solid-js'
import { render } from '@solidjs/web'
import { Lifecycle } from '@kinetic-router/lifecycle'
import { createCssTransition, type CssTransitionOptions } from './css-transition.js'

class NativeEffect {
  playState: AnimationPlayState = 'running'
  effect = { getComputedTiming: () => ({ endTime: this.endTime }) }
  endTime = 200
  resolve!: () => void
  reject!: (error: unknown) => void
  finished = new Promise<void>((resolve, reject) => { this.resolve = resolve; this.reject = reject })
  finish = vi.fn(() => { this.playState = 'finished'; this.resolve() })
  cancel = vi.fn(() => { this.playState = 'idle'; this.reject(new Error('cancelled')) })
}
class NativeTransition extends NativeEffect {
  transitionProperty: string
  constructor(property: string) { super(); this.transitionProperty = property }
}
class NativeAnimation extends NativeEffect {
  animationName: string
  constructor(name: string) { super(); this.animationName = name }
}

let media: EventTarget & { matches: boolean }
const disposers: (() => void)[] = []
const settle = () => new Promise<void>(resolve => onSettled(resolve))
beforeEach(() => {
  vi.stubGlobal('CSSTransition', NativeTransition)
  vi.stubGlobal('CSSAnimation', NativeAnimation)
  media = Object.assign(new EventTarget(), { matches: false })
  vi.spyOn(window, 'matchMedia').mockReturnValue(media as MediaQueryList)
})
afterEach(async () => {
  for (const dispose of disposers.splice(0)) dispose()
  await settle()
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function mount(options: CssTransitionOptions, effects: () => NativeEffect[]) {
  const [visible, show] = createSignal(true)
  const calls: { connected: boolean; direction: string }[] = []
  const host = document.createElement('div')
  document.body.append(host)
  let ref!: (element: HTMLElement) => void
  function Content() {
    ref = createCssTransition({ ...options, apply(element, direction) {
      calls.push({ connected: element.isConnected, direction })
      options.apply(element, direction)
    } })
    return <div ref={element => {
      element.getAnimations = () => effects() as unknown as Animation[]
      ref(element)
    }}>retained</div>
  }
  const dispose = render(() => <Lifecycle.Show when={visible()}><Content /></Lifecycle.Show>, host)
  disposers.push(dispose)
  return { host, show: (value: boolean) => { show(value); flush() }, calls, dispose, ref: () => ref }
}

const apply = (element: HTMLElement, direction: string) => { element.dataset.direction = direction }

describe('CSS lifecycle adapter', () => {
  it.each([
    { apply }, { apply, properties: [] }, { apply, animations: [''] },
    { apply, properties: ['all'] }, { apply, properties: 'opacity' },
    { apply, properties: ['opacity'], mode: 'parallel' },
    { properties: ['opacity'] },
  ])('rejects invalid options: %j', options => {
    expect(() => createCssTransition(options as CssTransitionOptions)).toThrow(TypeError)
  })

  it('requires a boundary', () => {
    createRoot(dispose => {
      try { expect(() => createCssTransition({ apply, properties: ['opacity'] })).toThrow('Lifecycle hooks require') }
      finally { dispose() }
    })
  })

  it('prepares before insertion, snapshots selectors, and ignores unrelated/infinite/WAAPI effects', async () => {
    const selected = new NativeTransition('grid-template-rows')
    const unrelated = new NativeTransition('opacity')
    const infinite = new NativeAnimation('decoration'); infinite.endTime = Infinity
    const waapi = new NativeEffect()
    const properties = ['grid-template-rows']
    const { host, show, calls, ref } = mount({ apply, properties, animations: ['decoration'] }, () => [selected, unrelated, infinite, waapi])
    properties[0] = 'opacity'
    expect(calls[0]).toEqual({ connected: false, direction: 'in' })
    expect(host.firstElementChild!.getAttribute('data-direction')).toBe('in')
    await settle()
    expect(calls[1]).toEqual({ connected: true, direction: 'in' })
    // Binding twice is harmless; binding another element is a mistake.
    ref()(host.firstElementChild as HTMLElement)
    expect(() => ref()(document.createElement('div'))).toThrow('only one element')
    show(false); await settle()
    expect(host.textContent).toBe('retained')
    selected.resolve()
    await vi.waitFor(() => expect(host.textContent).toBe(''))
    expect(unrelated.finish).not.toHaveBeenCalled()
    expect(infinite.finish).not.toHaveBeenCalled()
    expect(waapi.finish).not.toHaveBeenCalled()
  })

  it('treats CSS cancellation as completion without logging a lifecycle failure', async () => {
    const error = vi.spyOn(console, 'error')
    const effect = new NativeTransition('opacity')
    const { host, show } = mount({ apply, properties: ['opacity'] }, () => [effect])
    await settle()
    show(false); await settle()
    effect.cancel()
    await vi.waitFor(() => expect(host.textContent).toBe(''))
    expect(error).not.toHaveBeenCalled()
  })

  it('does not cancel CSS on reversal or let an old completion remove a reentered instance', async () => {
    let effect = new NativeTransition('opacity')
    const { host, show } = mount({ apply, properties: ['opacity'] }, () => [effect])
    await settle()
    const instance = host.firstElementChild
    effect.resolve(); await settle()
    const outgoing = effect = new NativeTransition('opacity')
    show(false); await settle()
    const incoming = effect = new NativeTransition('opacity')
    show(true); await settle()
    outgoing.resolve(); await settle()
    expect(host.firstElementChild).toBe(instance)
    expect(outgoing.cancel).not.toHaveBeenCalled()
    incoming.resolve(); await settle()
    show(false)
    await vi.waitFor(() => expect(host.textContent).toBe(''))
  })

  it('sequences separate entry before exit, including a named CSS animation', async () => {
    const enter = new NativeAnimation('enter'), exit = new NativeAnimation('exit')
    let direction = 'in'
    const { host, show, calls } = mount({
      mode: 'separate', animations: ['enter', 'exit'],
      apply(element, next) { apply(element, next); direction = next },
    }, () => [direction === 'in' ? enter : exit])
    await settle()
    show(false); await settle()
    expect(calls.map(call => call.direction)).toEqual(['in', 'in'])
    enter.resolve()
    await vi.waitFor(() => expect(calls.at(-1)!.direction).toBe('out'))
    expect(host.textContent).toBe('retained')
    exit.resolve()
    await vi.waitFor(() => expect(host.textContent).toBe(''))
  })

  it('finishes only selected motion for reduced motion and removes the listener on disposal', async () => {
    const selected = new NativeTransition('opacity'), decoration = new NativeAnimation('spin')
    const remove = vi.spyOn(media, 'removeEventListener')
    const { dispose } = mount({ apply, properties: ['opacity'] }, () => [selected, decoration])
    await settle()
    media.matches = true; media.dispatchEvent(new Event('change'))
    await settle()
    expect(selected.finish).toHaveBeenCalledTimes(1)
    expect(decoration.finish).not.toHaveBeenCalled()
    dispose()
    expect(remove).toHaveBeenCalledWith('change', expect.any(Function))
    media.dispatchEvent(new Event('change'))
    expect(selected.finish).toHaveBeenCalledTimes(1)
  })

  it('skips initial CSS delays when reduced motion is already enabled', async () => {
    media.matches = true
    const effect = new NativeAnimation('enter')
    mount({ apply, animations: ['enter'] }, () => [effect])
    await settle()
    expect(effect.finish).toHaveBeenCalledTimes(1)
  })
})
