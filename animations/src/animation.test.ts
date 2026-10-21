import { describe, expect, it } from 'vitest'
import { createAnimation, type AnimationTarget } from './animation.js'
import type { AnimationOptions } from './timing.js'

describe('reactive native target validation', () => {
  it.each([
    {}, { opacity: NaN }, { opacity: -1 }, { opacity: 2 }, { transform: '' },
    { width: '100px' }, { offset: 0, opacity: 1 }, { x: 100 },
  ])('rejects invalid targets: %j', value => {
    expect(() => createAnimation(() => value as AnimationTarget)).toThrow(TypeError)
  })

  it.each([
    { duration: Infinity }, { duration: -1 }, { duration: { in: 100, out: 200 } },
    { delay: -1 }, { easing: '' }, { easing: () => 1 }, { iterations: Infinity },
    { duration: Number.MAX_VALUE, delay: Number.MAX_VALUE },
  ])('rejects unsafe/non-native options: %j', options => {
    expect(() => createAnimation(() => ({ opacity: 1 }), options as AnimationOptions)).toThrow(TypeError)
  })

  it('requires an owner but not a lifecycle boundary', () => {
    expect(() => createAnimation(() => ({ opacity: 1 }))).toThrow('reactive owner')
  })
})
