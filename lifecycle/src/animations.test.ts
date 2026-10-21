import { describe, expect, it } from 'vitest'
import { createRoot } from 'solid-js'
import { createTransition, fade, fadeScale, slide, type Transition, type TransitionOptions } from './animations.js'

describe('animation helper validation', () => {
  it.each([
    { inout: [{ opacity: 0 }] },
    { inout: [{ opacity: 0 }, { opacity: 1, transform: 'none' }] },
    { inout: [{ opacity: NaN }, { opacity: 1 }] },
    { inout: [{ opacity: -1 }, { opacity: 1 }] },
    { inout: [{ transform: '' }, { transform: 'none' }] },
    { inout: [{ opacity: 0 }, { opacity: 0.2, offset: 0.8 }, { opacity: 0.8, offset: 0.2 }, { opacity: 1 }] },
    { inout: [{ opacity: 0 }, { opacity: 1, offset: Infinity }] },
    { inout: [{ opacity: 0, offset: 0.2 }, { opacity: 1 }] },
    { inout: [{ opacity: 0 }, { opacity: 1, offset: 0.8 }] },
  ])('rejects invalid or non-compositor keyframes: %j', transition => {
    expect(() => createTransition(transition as Transition)).toThrow(TypeError)
  })

  it.each([
    { duration: Infinity }, { duration: NaN }, { duration: -1 },
    { delay: Infinity }, { delay: -1 },
    { duration: Number.MAX_VALUE, delay: Number.MAX_VALUE }, { fill: 'none' },
  ])('rejects unsafe timing: %j', options => {
    expect(() => createTransition(fade, options as TransitionOptions)).toThrow(TypeError)
  })

  it('requires a lifecycle boundary instead of silently doing nothing', () => {
    createRoot(dispose => {
      try { expect(() => createTransition(fade)).toThrow('Lifecycle hooks require') }
      finally { dispose() }
    })
  })

  it('supplies explicit, compositor-friendly presets', () => {
    expect(fade.inout).toEqual([{ opacity: 0 }, { opacity: 1 }])
    expect(fadeScale.inout[1]).toEqual({ opacity: 1, transform: 'scale(1)' })
    expect(slide({ x: -20, y: 0 }).inout).toEqual([
      { opacity: 0, transform: 'translate(-20px, 0px)' },
      { opacity: 1, transform: 'translate(0px, 0px)' },
    ])
    expect(() => slide({ x: Infinity })).toThrow(TypeError)
  })
})

it('rejects unsafe shapes both statically and at runtime', () => {
  // @ts-expect-error A transition needs at least one direction.
  expect(() => createTransition({})).toThrow(TypeError)
  // @ts-expect-error Layout properties are intentionally unsupported.
  expect(() => createTransition({ inout: [{ width: '0px' }, { width: '10px' }] })).toThrow(TypeError)
  // @ts-expect-error Infinite/repeated playback cannot pin a lifecycle boundary.
  expect(() => createTransition(fade, { iterations: Infinity })).toThrow(TypeError)
  // @ts-expect-error Bidirectional and separate modes are mutually exclusive.
  expect(() => createTransition({ inout: fade.inout, out: fade.inout })).toThrow(TypeError)
})
