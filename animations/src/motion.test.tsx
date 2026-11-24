import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import {
  createContext, createMemo, createRoot, createSignal, Errored, flush, Loading, onCleanup,
  onSettled, Show, useContext,
} from 'solid-js'
import { render, type JSX } from '@solidjs/web'
import { Lifecycle as Lc, onExit } from '@kinetic-router/lifecycle'
import { Motion, motion, type MotionProps, type MotionTagProps, type MotionTarget } from './index.js'

class TargetAnimation {
  playState: AnimationPlayState = 'paused'
  resolve!: (animation: this) => void
  reject!: (error: unknown) => void
  finished = new Promise<this>((resolve, reject) => { this.resolve = resolve; this.reject = reject })
  readonly effect: KeyframeEffect
  readonly targetWasConnected: boolean
  constructor(effect: KeyframeEffect) {
    this.effect = effect
    this.targetWasConnected = effect.target!.isConnected
    effects.push(this)
    // WAAPI marks its finished-promise rejection as handled on cancellation.
    void this.finished.catch(() => {})
  }
  persist() {}
  play() { this.playState = 'running' }
  finish() { this.playState = 'finished'; this.resolve(this) }
  cancel() { this.playState = 'idle'; this.reject(new DOMException('Cancelled', 'AbortError')) }
}

let effects: TargetAnimation[]
const disposers: (() => void)[] = []
const current = () => effects.at(-1)!
const frames = () => current().effect.getKeyframes()
const settle = () => new Promise<void>(resolve => onSettled(resolve))

function mount(view: () => JSX.Element) {
  const host = document.body.appendChild(document.createElement('div'))
  const dispose = render(view, host)
  disposers.push(dispose)
  return host
}

beforeEach(() => {
  effects = []
  vi.stubGlobal('Animation', TargetAnimation)
})

afterEach(async () => {
  for (const dispose of disposers.splice(0)) dispose()
  await settle()
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('motion', () => {
  it('forwards reactive DOM props, children, and refs', async () => {
    const [label, setLabel] = createSignal('first')
    const onFirst = vi.fn(), onSecond = vi.fn()
    const secondRef = vi.fn()
    const firstRef = vi.fn<(element: HTMLButtonElement) => void>()
    const host = mount(() => <motion.button
      animate={{ opacity: 0.75 }} initial={false} transition={{ duration: 10 }}
      ref={[firstRef, secondRef]} type="button" title={label()} data-label={label()}
      style={{ transform: 'rotate(12deg)', color: label() === 'first' ? 'red' : 'blue' }}
      onClick={label() === 'first' ? onFirst : onSecond}
    >{label()}</motion.button>)
    const button = host.firstElementChild as HTMLButtonElement
    expect(button).toBeInstanceOf(HTMLButtonElement)
    expect(firstRef).toHaveBeenCalledWith(button)
    expect(secondRef).toHaveBeenCalledWith(button)
    expect(button.style.transform).toBe('rotate(12deg)')
    for (const key of ['animate', 'initial', 'transition']) expect(button.hasAttribute(key)).toBe(false)
    button.click()
    setLabel('second'); flush()
    await settle()
    expect(button.textContent).toBe('second')
    expect(button.title).toBe('second')
    expect(button.dataset.label).toBe('second')
    expect(button.style.color).toBe('blue')
    expect(firstRef).toHaveBeenCalledTimes(1)
    button.click()
    expect(onFirst).toHaveBeenCalledTimes(1)
    expect(onSecond).toHaveBeenCalledTimes(1)
  })

  it('retains the exit endpoint while independent work is pending', async () => {
    const [when, show] = createSignal(true)
    const [x, setX] = createSignal(20)
    let release!: () => void
    const hold = new Promise<void>(resolve => { release = resolve })
    function Row() {
      onExit(() => hold)
      return <li />
    }
    const host = mount(() => <Lc.Show when={when()}>
      <Motion initial={false} animate={{ x: x(), opacity: 1 }} exit={{ opacity: 0 }}><Row /></Motion>
    </Lc.Show>)
    await settle()
    const row = host.firstElementChild
    show(false); await settle()
    const outgoing = current()
    setX(44); await settle()
    expect(current()).toBe(outgoing)
    outgoing.finish(); await settle()
    expect(host.firstElementChild).toBe(row)
    expect(outgoing.playState).toBe('finished')
    expect(row?.hasAttribute('exit')).toBe(false)

    show(true); await settle()
    expect(host.firstElementChild).toBe(row)
    expect(current().playState).toBe('running')
    expect(frames()[1]).toMatchObject({ opacity: '1', transform: 'translate(44px, 0px) rotate(0deg) scale(1)' })

    show(false); await settle()
    release(); await settle()
    expect(host.firstElementChild).toBe(row)
    current().finish(); await settle()
    expect(host.firstElementChild).toBeNull()
  })

  it.each([false, undefined, { opacity: 0 }] as const)('applies initial=%j at the first Loading-held present commit', async initial => {
    const [opacity, setOpacity] = createSignal(0.25)
    let reveal!: () => void
    function Panel() {
      const ready = createMemo(() => new Promise<string>(resolve => { reveal = () => resolve('ready') }))
      return <Motion initial={initial} animate={{ opacity: opacity() }} exit={{ opacity: 0 }}>
        <section>{ready()}</section>
      </Motion>
    }
    const host = mount(() => <Lc.Show when={true}>
      <Loading fallback="loading"><Panel /></Loading>
    </Lc.Show>)
    try {
      await settle()
      expect(host.textContent).toBe('loading')
      setOpacity(0.75); await settle()
      expect(host.textContent).toBe('loading')
      expect(effects).toHaveLength(1)
      expect(current().targetWasConnected).toBe(false)
      expect(frames()[0]?.opacity).toBe(initial ? '0' : '0.25')
      reveal()
      await vi.waitFor(() => expect(host.textContent).toBe('ready'))
      await settle()
      expect(current().playState).toBe(initial ? 'running' : 'finished')
      expect(frames().map(frame => frame.opacity)).toEqual(initial ? ['0', '0.75'] : ['0.75', '0.75'])
      current().finish()
      setOpacity(0.5); await settle()
      expect(current().playState).toBe('running')
      expect(frames()[1]?.opacity).toBe('0.5')
    } finally {
      reveal(); await settle()
    }
  })

  it.each([{ opacity: -1 }, { x: Infinity }, { scale: NaN }, { transform: 'none' }])('rejects unsupported targets: %j', animate => {
    expect(() => motion.div({ animate: animate as MotionTarget })).toThrow(TypeError)
  })

  it('requires a real boundary for exits', () => {
    createRoot(dispose => {
      try { expect(() => motion.div({ animate: { opacity: 1 }, exit: { opacity: 0 } })).toThrow('Lifecycle hooks require') }
      finally { dispose() }
    })
  })

  it('exports only the native shorthands with tag-specific props and refs', () => {
    expectTypeOf<keyof typeof motion>().toEqualTypeOf<'div' | 'span' | 'section' | 'button' | 'li'>()
    expectTypeOf<MotionTagProps<'button'>['ref']>().toEqualTypeOf<JSX.Ref<HTMLButtonElement>>()
    expectTypeOf<MotionTagProps<'li'>['animate']>().toEqualTypeOf<MotionTarget>()
    expect(Object.keys(motion)).toEqual(['div', 'span', 'section', 'button', 'li'])
  })
})

describe('Motion', () => {
  it('animates the child element itself without repeating setup or losing context, props, state, or its ref', async () => {
    expectTypeOf<Parameters<typeof Motion>[0]>().toEqualTypeOf<MotionProps>()
    expectTypeOf<keyof MotionProps>().toEqualTypeOf<'animate' | 'initial' | 'exit' | 'transition' | 'children'>()
    const Context = createContext('default')
    const [opacity, setOpacity] = createSignal(0.75)
    const [label, setLabel] = createSignal('before')
    const [visible, setVisible] = createSignal(true)
    const setup = vi.fn(), cleaned = vi.fn()
    const ref = vi.fn<(element: HTMLButtonElement) => void>()
    function Card(props: { label: string }) {
      setup()
      onCleanup(cleaned)
      const context = useContext(Context)
      const [count, setCount] = createSignal(0)
      return <button ref={ref} title={props.label} onClick={() => setCount(n => n + 1)}>
        <span>{context}:{count()}</span>
      </button>
    }
    const host = mount(() => <Context value="provided">
      <Show when={visible()}>
        <Motion initial={{ opacity: 0 }} animate={{ opacity: opacity() }}>
          <><Card label={label()} /></>
        </Motion>
      </Show>
    </Context>)
    const button = host.firstElementChild as HTMLButtonElement
    expect(ref).toHaveBeenCalledExactlyOnceWith(button)
    expect(button.textContent).toBe('provided:0')
    expect(effects[0]!.targetWasConnected).toBe(false)
    expect(effects[0]!.effect.getKeyframes()[0]?.opacity).toBe('0')
    expect(current().playState).toBe('running')

    button.click()
    setLabel('after'); setOpacity(0.5); await settle()
    expect(host.firstElementChild).toBe(button)
    expect(button.textContent).toBe('provided:1')
    expect(button.title).toBe('after')
    expect(setup).toHaveBeenCalledOnce()
    expect(ref).toHaveBeenCalledOnce()
    expect(effects.every(({ effect }) => effect.target === button)).toBe(true)
    expect(frames()[1]?.opacity).toBe('0.5')

    setVisible(false); await settle()
    expect(host.firstElementChild).toBeNull()
    expect(cleaned).toHaveBeenCalledOnce()
    expect(current().playState).toBe('idle')
  })

  it.each([
    ['empty', (): JSX.Element => null],
    ['text', (): JSX.Element => 'text'],
    ['multiple roots', (): JSX.Element => <><i /><b /></>],
  ] as const)('reports %s to Solid’s error boundary without binding', async (_, view) => {
    const host = mount(() => <Errored fallback={error => String(error())}>
      <Motion animate={{ opacity: 1 }}>{view()}</Motion>
    </Errored>)
    await settle()
    expect(host.textContent).toContain('Motion requires one DOM Element child')
    expect(effects).toHaveLength(0)
  })

  it('reports a replaced root without retargeting and cleans up when the errored owner unmounts', async () => {
    const [first, setFirst] = createSignal(true)
    const [visible, setVisible] = createSignal(true)
    const [opacity, setOpacity] = createSignal(1)
    const cleaned = vi.fn()
    function Card() {
      onCleanup(cleaned)
      return <Show when={first()} fallback={<article />}><article /></Show>
    }
    const host = mount(() => <Show when={visible()}>
      <Errored fallback={error => String(error())}>
        <Motion animate={{ opacity: opacity() }}><Card /></Motion>
      </Errored>
    </Show>)
    const original = host.firstElementChild
    const previous = current()
    expect(previous.effect.target).toBe(original)

    setFirst(false); await settle()
    expect(host.textContent).toContain('Motion child replaced its root element')
    expect(original?.isConnected).toBe(false)
    setOpacity(0.5); await settle()
    expect(effects).toHaveLength(1)

    // Solid keeps errored content alive behind its fallback so it can retry.
    setVisible(false); await settle()
    expect(previous.playState).toBe('idle')
    expect(cleaned).toHaveBeenCalledOnce()
  })
})
