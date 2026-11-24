import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { createMemo, createRoot, createSignal, flush, Loading, onSettled } from 'solid-js'
import { render, type JSX } from '@solidjs/web'
import { Lifecycle as Lc, onExit } from '@kinetic-router/lifecycle'
import { motion, type MotionProps, type MotionTarget } from './index.js'

class TargetAnimation {
  playState: AnimationPlayState = 'paused'
  resolve!: (animation: this) => void
  reject!: (error: unknown) => void
  finished = new Promise<this>((resolve, reject) => { this.resolve = resolve; this.reject = reject })
  readonly effect: KeyframeEffect
  constructor(effect: KeyframeEffect) {
    this.effect = effect
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
      return <motion.li initial={false} animate={{ x: x(), opacity: 1 }} exit={{ opacity: 0 }} />
    }
    const host = mount(() => <Lc.Show when={when()}><Row /></Lc.Show>)
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
      return <motion.section initial={initial} animate={{ opacity: opacity() }} exit={{ opacity: 0 }}>{ready()}</motion.section>
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

  it('creates other native HTML tags with their own props and ref type', () => {
    const Input = motion.create('input')
    expectTypeOf<Parameters<typeof Input>[0]['ref']>().toEqualTypeOf<JSX.Ref<HTMLInputElement>>()
    expectTypeOf<'svg'>().not.toExtend<Parameters<typeof motion.create>[0]>()
    expectTypeOf<MotionProps<'button'>['ref']>().toEqualTypeOf<JSX.Ref<HTMLButtonElement>>()
    expectTypeOf<MotionProps<'li'>['animate']>().toEqualTypeOf<MotionTarget>()
    const ref = vi.fn((el: HTMLInputElement) => expect(el).toBeInstanceOf(HTMLInputElement))
    const host = mount(() => <Input animate={{ opacity: 1 }} ref={ref} type="checkbox" checked />)
    expect(ref).toHaveBeenCalledWith(host.firstElementChild)
    expect((host.firstElementChild as HTMLInputElement).checked).toBe(true)
    expect(Object.keys(motion)).toEqual(['div', 'span', 'section', 'button', 'li', 'create'])
  })
})
