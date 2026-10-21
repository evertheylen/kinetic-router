import { describe, expect, it } from 'vitest'
import { spring, type SpringOptions } from './spring.js'

const samples = (easing: string) => easing.slice(7, -1).split(',').map(Number)

describe('native spring compiler', () => {
  it('returns bounded, deterministic native timing with exact endpoints and overshoot', () => {
    const result = spring()
    expect(spring()).toEqual(result)
    expect(result.duration).toBeGreaterThan(0)
    expect(result.duration).toBeLessThanOrEqual(10000)
    const values = samples(result.easing)
    expect(values[0]).toBe(0)
    expect(values.at(-1)).toBe(1)
    expect(values.every(Number.isFinite)).toBe(true)
    expect(values.length).toBeLessThanOrEqual(4096)
    expect(Math.max(...values)).toBeGreaterThan(1.1)
  })

  it.each([20, 20.00001, 30])('compiles critically/overdamped motion monotonically (damping %s)', damping => {
    const values = samples(spring({ damping }).easing)
    expect(values.every((value, index) => value >= (values[index - 1] ?? 0))).toBe(true)
    expect(Math.max(...values)).toBe(1)
  })

  it('uses mass and stiffness, and samples fast springs more densely', () => {
    expect(spring({ mass: 2 })).not.toEqual(spring())
    const fast = spring({ stiffness: 10000, damping: 100 })
    expect(fast.duration).toBeLessThan(spring().duration)
    expect(samples(fast.easing).length).toBeGreaterThan(fast.duration / 1000 * 120)
  })

  it.each([
    { stiffness: 0 }, { stiffness: -1 }, { stiffness: NaN }, { stiffness: Infinity },
    { damping: 0 }, { damping: -1 }, { damping: NaN }, { damping: Infinity },
    { mass: 0 }, { mass: -1 }, { mass: NaN }, { mass: Infinity }, { velocity: 1 },
  ])('rejects invalid configuration: %j', options => {
    expect(() => spring(options as SpringOptions)).toThrow(TypeError)
  })

  it.each([
    { damping: 0.001 }, { stiffness: 0.0001, damping: 100 },
    { stiffness: Number.MAX_VALUE, mass: Number.MIN_VALUE },
    { stiffness: Number.MIN_VALUE, mass: Number.MAX_VALUE },
    { damping: Number.MAX_VALUE, mass: Number.MIN_VALUE },
  ])('rejects non-settling or numerically unsafe springs: %j', options => {
    expect(() => spring(options)).toThrow(RangeError)
  })
})
