/** Seeded randomness, so a diagram renders the same every time from the same source. */

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number
  /** Uniform in [min, max). */
  range(bounds: { min: number; max: number }): number
  /** Roughly normal, mean 0, standard deviation 1. */
  normal(): number
  /** A fresh generator derived from this one and a label, so parts don't shift each other. */
  fork(label: string): Rng
}

export function hash(text: string): number {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  return h1 >>> 0
}

export function rng(seed: number): Rng {
  let state = seed >>> 0 || 1
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    range({ min, max }) {
      return min + (max - min) * next()
    },
    normal() {
      return (next() + next() + next() + next() - 2) * 1.7320508
    },
    fork(label) {
      return rng(hash(`${seed}:${label}`))
    },
  }
}
