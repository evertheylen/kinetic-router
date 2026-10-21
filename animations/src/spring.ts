export interface SpringOptions {
  /** Default 100; must be finite and positive. */
  stiffness?: number
  /** Default 10; must be finite and positive (undamped springs never settle). */
  damping?: number
  /** Default 1; must be finite and positive. */
  mass?: number
}

/**
 * Compile a normalized, initially stationary 0→1 spring once into native timing.
 * Returns milliseconds and a CSS linear() easing string, usable with either native
 * helper or element.animate(). No runtime physics, JS frame loop, or dependency.
 * Overshoot is preserved; the final sample is exactly 1. Reversing an inout effect
 * retraces this curve, not a newly simulated spring with carried velocity.
 *
 * Samples at least 120Hz (more for high frequencies), until both the remaining
 * displacement and speed envelopes are below 0.001. Rejects springs that cannot
 * settle within 10 seconds / 4096 samples rather than truncating or running forever.
 * Requires native CSS linear() easing support; there is no JS fallback.
 */
export function spring(options: SpringOptions = {}): { duration: number; easing: string } {
  const { stiffness = 100, damping = 10, mass = 1 } = options
  if (Object.keys(options).some(key => !['stiffness', 'damping', 'mass'].includes(key))
    || [stiffness, damping, mass].some(value => !Number.isFinite(value) || value <= 0)) {
    throw new TypeError('Spring stiffness, damping, and mass must be finite and positive')
  }
  const squared = stiffness / mass, omega = Math.sqrt(squared), alpha = damping / mass / 2
  if (![squared, omega, alpha].every(value => Number.isFinite(value) && value > 0)) {
    throw new RangeError('Spring parameters exceed the supported numeric range')
  }
  let sample: (time: number) => { value: number; displacement: number; speed: number }
  if (Math.abs(alpha / omega - 1) < 0.0001) {
    sample = time => {
      const decay = Math.exp(-omega * time)
      const displacement = decay * (1 + omega * time)
      return { value: 1 - displacement, displacement, speed: squared * time * decay }
    }
  } else if (alpha < omega) {
    const frequency = Math.sqrt(squared - alpha * alpha)
    sample = time => {
      const decay = Math.exp(-alpha * time)
      return {
        value: 1 - decay * (Math.cos(frequency * time) + alpha / frequency * Math.sin(frequency * time)),
        displacement: decay * Math.hypot(1, alpha / frequency),
        speed: decay * squared / frequency,
      }
    }
  } else {
    // Stable roots: avoid cancellation when damping is much larger than stiffness.
    const root = Math.sqrt(alpha - omega) * Math.sqrt(alpha + omega)
    const slow = -squared / (alpha + root), fast = -(alpha + root)
    sample = time => {
      const a = Math.exp(slow * time), b = Math.exp(fast * time)
      const displacement = (fast * a - slow * b) / (fast - slow)
      return { value: 1 - displacement, displacement, speed: Math.abs(slow * fast * (a - b) / (fast - slow)) }
    }
  }
  const step = Math.min(1 / 120, 1 / (omega * 8))
  const values = [0]
  for (let index = 1; index < 4096 && index * step <= 10; index++) {
    const time = index * step
    const { value, displacement, speed } = sample(time)
    if (![value, displacement, speed].every(Number.isFinite)) break
    values.push(Number(value.toFixed(6)))
    if (displacement < 0.001 && speed < 0.001) {
      values[values.length - 1] = 1
      return { duration: time * 1000, easing: `linear(${values.join(', ')})` }
    }
  }
  throw new RangeError('Spring must settle within 10 seconds and 4096 samples')
}
