import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { createRoot, createSignal, Errored, flush, onSettled, Show } from 'solid-js'
import { render, type JSX } from '@solidjs/web'
import { Lifecycle, onExit } from '@kinetic-router/lifecycle'
import { AnimatePresence, motion, type MotionProps, type MotionTarget } from './index.js'

class TargetAnimation {
  playState: AnimationPlayState = 'paused'
  resolve!: (animation: this) => void
  reject!: (error: unknown) => void
  finished = new Promise<this>((resolve, reject) => { this.resolve = resolve; this.reject = reject })
  readonly effect: KeyframeEffect
  readonly timeline: AnimationTimeline
  constructor(effect: KeyframeEffect, timeline: AnimationTimeline) {
    this.effect = effect
    this.timeline = timeline
    effects.push(this)
    // WAAPI marks its finished-promise rejection as handled on cancellation.
    void this.finished.catch(() => {})
  }
  persist() {}
  connectedAtPlay?: boolean
  play = vi.fn(() => {
    this.connectedAtPlay = this.effect.target?.isConnected
    this.playState = 'running'
  })
  finish = vi.fn(() => { this.playState = 'finished'; this.resolve(this) })
  cancel = vi.fn(() => { this.playState = 'idle'; this.reject(new DOMException('Cancelled', 'AbortError')) })
}

let media: EventTarget & { matches: boolean }
let effects: TargetAnimation[]
const disposers: (() => void)[] = []
const current = () => effects.at(-1)!
const frames = () => current().effect.getKeyframes()
const settle = () => new Promise<void>(resolve => onSettled(resolve))
const sample = (opacity: string, transform: string) => vi.stubGlobal('getComputedStyle', vi.fn(() => ({ opacity, transform })))

function mount(view: () => JSX.Element) {
  const host = document.body.appendChild(document.createElement('div'))
  const dispose = render(view, host)
  disposers.push(dispose)
  return host
}

beforeEach(() => {
  effects = []
  vi.stubGlobal('Animation', TargetAnimation)
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

describe('motion', () => {
  it.each([false, undefined] as const)('snaps initial=%s and forwards reactive DOM props, children, and refs', async initial => {
    const [label, setLabel] = createSignal('first')
    const onFirst = vi.fn(), onSecond = vi.fn()
    const secondRef = vi.fn()
    const firstRef = vi.fn((element: HTMLButtonElement) => {
      expect(element.isConnected).toBe(false)
      expect(frames()[1]).toMatchObject({ opacity: '0.75' })
    })
    const host = mount(() => <motion.button
      animate={{ opacity: 0.75 }} initial={initial} transition={{ duration: 10 }}
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
    expect(frames()[1]).not.toHaveProperty('transform')
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
    expect(effects).toHaveLength(1)
    expect(current().play).not.toHaveBeenCalled()
  })

  it('prepares partial initial poses detached and plays at commit outside presence', async () => {
    const prepared = vi.fn((element: HTMLElement) => {
      expect(element.isConnected).toBe(false)
      expect(current().timeline).toBe(document.timeline)
      expect(current().play).not.toHaveBeenCalled()
      expect(frames()[1]).toMatchObject({ opacity: '0.9', transform: 'translate(-8px, 12px) rotate(45deg) scale(2)' })
    })
    const host = mount(() => <motion.section ref={prepared} initial={{ x: -8 }}
      animate={{ opacity: 0.9, y: 12, rotate: 45, scale: 2 }}
      transition={{ duration: 0.2, delay: 0.05, ease: 'easeInOut' }} />)
    expect(prepared).toHaveBeenCalledOnce()
    await settle()
    expect(current().effect.target).toBe(host.firstElementChild)
    expect(current().effect.getTiming()).toMatchObject({ duration: 200, delay: 50, easing: 'ease-in-out', fill: 'both' })
    expect(frames()[1]).toMatchObject({ opacity: '0.9', transform: 'translate(0px, 12px) rotate(45deg) scale(2)' })
    expect(current().play).toHaveBeenCalledOnce()
    expect(current().connectedAtPlay).toBe(true)
  })

  it('retargets from the rendered pose and cancels on ordinary unmount', async () => {
    const [when, show] = createSignal(true)
    const [pose, setPose] = createSignal<MotionTarget>({ opacity: 1, rotate: 0 })
    const [duration, slow] = createSignal(0.2)
    const host = mount(() => <Show when={when()}><motion.span animate={pose()} transition={{ duration: duration(), ease: 'linear' }} /></Show>)
    const element = host.firstElementChild
    setPose({ opacity: 0.6, rotate: 360 }); await settle()
    expect(frames()[0]).toMatchObject({ opacity: '1', transform: 'translate(0px, 0px) rotate(0deg) scale(1)' })
    const old = current()
    slow(0.8); await settle()
    expect(current()).toBe(old)
    sample('0.8', 'matrix(0, 1, -1, 0, 0, 0)')
    setPose({ x: 40 }); await settle()
    expect(frames()[0]).toMatchObject({ opacity: '0.8', transform: 'matrix(0, 1, -1, 0, 0, 0)' })
    expect(frames()[1]).toMatchObject({ opacity: '1', transform: 'translate(40px, 0px) rotate(0deg) scale(1)' })
    expect(current().effect.getTiming()).toMatchObject({ duration: 800, easing: 'linear' })
    expect(old.cancel).toHaveBeenCalledOnce()
    expect(host.firstElementChild).toBe(element)
    show(false); await settle()
    expect(host.firstElementChild).toBeNull()
    expect(current().cancel).toHaveBeenCalledOnce()
  })

  it('retains a filled exit until other exit work completes and retargets the same owner on undo', async () => {
    const [when, show] = createSignal(true)
    const [x, setX] = createSignal(20)
    const [duration, slow] = createSignal(0.2)
    let release!: () => void
    const hold = new Promise<void>(resolve => { release = resolve })
    const mounts = vi.fn()
    function Row() {
      mounts()
      onExit(() => hold)
      const [count, setCount] = createSignal(0)
      return <motion.li initial={{ opacity: 0 }} animate={{ x: x(), opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ duration: duration(), ease: 'easeOut' }} onClick={() => setCount(count() + 1)}>{String(count())}</motion.li>
    }
    const host = mount(() => <AnimatePresence when={when()}><Row /></AnimatePresence>)
    expect(AnimatePresence).toBe(Lifecycle.Show)
    await settle()
    const row = host.firstElementChild as HTMLLIElement
    row.click(); flush()
    sample('0.4', 'matrix(1, 0, 0, 1, 20, 0)')
    slow(0.8); show(false); await settle()
    const outgoing = current()
    expect(frames()[0]).toMatchObject({ opacity: '0.4', transform: 'matrix(1, 0, 0, 1, 20, 0)' })
    expect(frames()[1]).toMatchObject({ opacity: '0', transform: 'translate(20px, 0px) rotate(0deg) scale(1)' })
    expect(outgoing.effect.getTiming()).toMatchObject({ duration: 800, easing: 'ease-out' })
    setX(44); await settle()
    expect(current()).toBe(outgoing)
    outgoing.finish(); await settle()
    expect(host.firstElementChild).toBe(row)
    expect(outgoing.cancel).not.toHaveBeenCalled()
    expect(row.hasAttribute('exit')).toBe(false)
    show(true); await settle()
    expect(frames()[0]).toMatchObject({ opacity: '0' })
    expect(frames()[1]).toMatchObject({ opacity: '1', transform: 'translate(44px, 0px) rotate(0deg) scale(1)' })
    expect(outgoing.cancel).toHaveBeenCalledOnce()
    expect(host.firstElementChild).toBe(row)
    expect(row.textContent).toBe('1')
    expect(mounts).toHaveBeenCalledOnce()

    show(false); await settle()
    const reversed = current()
    sample('0.7', 'matrix(1, 0, 0, 1, 44, 0)')
    show(true); await settle()
    expect(reversed.cancel).toHaveBeenCalledOnce()
    expect(frames()[0]).toMatchObject({ opacity: '0.7' })
    release(); await settle()
    expect(host.firstElementChild).toBe(row)
    show(false); await settle()
    current().finish()
    await current().finished; await settle()
    expect(host.firstElementChild).toBeNull()
    expect(current().cancel).toHaveBeenCalledOnce()
  })

  it('skips motion and delay at mount, and finishes and releases an exit when the preference changes', async () => {
    const remove = vi.spyOn(media, 'removeEventListener')
    media.matches = true
    const [when, show] = createSignal(true)
    const host = mount(() => <AnimatePresence when={when()}><motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      exit={{ opacity: 0 }} transition={{ duration: 10, delay: 10 }} /></AnimatePresence>)
    await settle()
    expect(frames()[1]).toMatchObject({ opacity: '1' })
    expect(effects).toHaveLength(1)
    expect(current().play).not.toHaveBeenCalled()
    media.matches = false; media.dispatchEvent(new Event('change'))
    show(false); await settle()
    expect(current().play).toHaveBeenCalledOnce()
    media.matches = true; media.dispatchEvent(new Event('change'))
    expect(current().finish).toHaveBeenCalledOnce()
    await current().finished; await settle()
    expect(host.firstElementChild).toBeNull()
    expect(remove).toHaveBeenCalledWith('change', expect.any(Function))
  })

  it.each([{ opacity: -1 }, { x: Infinity }, { scale: NaN }, { transform: 'none' }])('rejects unsupported targets: %j', animate => {
    expect(() => motion.div({ animate: animate as MotionTarget })).toThrow(TypeError)
  })

  it('rejects new native channels on reactive target updates', async () => {
    const [pose, setPose] = createSignal<MotionTarget>({ opacity: 1 })
    const host = mount(() => <Errored fallback={error => <p>{String(error())}</p>}>
      <motion.div animate={pose()} />
    </Errored>)
    setPose({ opacity: 0.5, x: 10 }); await settle()
    expect(host.textContent).toContain('Cannot add an opacity or transform channel')
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
