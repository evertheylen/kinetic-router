import { describe, expect, it, vi } from 'vitest'
import { createRoot } from 'solid-js'
import { createAnimation, type AnimationTarget } from './animation.js'
import type { AnimationOptions } from './timing.js'

describe('reactive native target validation', () => {
  it.each([
    {}, { opacity: NaN }, { opacity: -1 }, { opacity: 2 }, { transform: '' },
    { width: '100px' }, { offset: 0, opacity: 1 }, { x: 100 },
  ])('rejects invalid targets: %j', value => {
    createRoot(dispose => {
      try {
        const bind = createAnimation(() => value as AnimationTarget)
        expect(() => bind(document.createElement('div'))).toThrow(TypeError)
      } finally { dispose() }
    })
  })

  it.each([
    { duration: Infinity }, { duration: -1 }, { duration: { in: 100, out: 200 } },
    { delay: -1 }, { easing: '' }, { easing: () => 1 }, { iterations: Infinity },
    { duration: Number.MAX_VALUE, delay: Number.MAX_VALUE },
  ])('rejects unsafe/non-native options: %j', options => {
    expect(() => createAnimation(() => ({ opacity: 1 }), options as AnimationOptions)).toThrow(TypeError)
  })

  it('does not read a target before its ref is bound', () => {
    const target = vi.fn(() => ({ opacity: 1 }))
    createRoot(dispose => {
      createAnimation(target)
      dispose()
    })
    expect(target).not.toHaveBeenCalled()
  })

  it('requires an owner but not a lifecycle boundary', () => {
    expect(() => createAnimation(() => ({ opacity: 1 }))).toThrow('reactive owner')
  })
})
