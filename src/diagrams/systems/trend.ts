import { h, n } from '../../core/svg.ts'
import type { Tokens } from '../../theme/index.ts'

/** Behaviour over time, drawn as a small sketch beside a variable or under a loop's name. */
export type Trend = 'grow' | 'decline' | 'approach' | 's-curve' | 'oscillate'

const TREND_W = 30
const TREND_H = 14

/**
 * Each shape as height (0 to 1) over time (0 to 1), and the level drawn dashed behind it: where it
 * settles, or where growth takes off from.
 */
const SHAPES: Record<Trend, { y: (t: number) => number; goal?: number }> = {
  grow: { y: (t) => (Math.exp(3 * t) - 1) / (Math.exp(3) - 1), goal: 0 },
  decline: { y: (t) => Math.exp(-3.2 * t), goal: 0 },
  approach: { y: (t) => 1 - Math.exp(-3.5 * t), goal: 1 },
  's-curve': { y: (t) => 1 / (1 + Math.exp(-10 * (t - 0.45))), goal: 1 },
  oscillate: { y: (t) => 0.5 + 0.48 * Math.exp(-1.6 * t) * Math.sin(4.2 * Math.PI * t), goal: 0.5 },
}

const WORDS: Record<string, Trend> = {
  grow: 'grow',
  growth: 'grow',
  exponential: 'grow',
  up: 'grow',
  rise: 'grow',
  decline: 'decline',
  decay: 'decline',
  down: 'decline',
  fall: 'decline',
  approach: 'approach',
  goal: 'approach',
  'goal-seeking': 'approach',
  asymptote: 'approach',
  's-curve': 's-curve',
  s: 's-curve',
  logistic: 's-curve',
  oscillate: 'oscillate',
  oscillation: 'oscillate',
  wave: 'oscillate',
}

/** The trend a word names, such as `grow` or `logistic`, or null. */
export function readTrend(word: string): Trend | null {
  return WORDS[word.trim().toLowerCase()] ?? null
}

export const TREND_NAMES = Object.keys(SHAPES)

const STEPS = 30

/**
 * A trend sketch, w × h with its center at (cx, cy): the settling level dashed and the curve in
 * `ink`, on faint axes unless it sits inside a frame of its own.
 */
export function drawTrend({
  trend,
  cx,
  cy,
  ink,
  tokens,
  w = TREND_W,
  h: height = TREND_H,
  axes = true,
}: {
  trend: Trend
  cx: number
  cy: number
  ink: string
  tokens: Tokens
  w?: number
  h?: number
  axes?: boolean
}): string {
  const shape = SHAPES[trend]
  const x = cx - w / 2
  const y = cy - height / 2
  const at = (t: number) => `${n(x + t * w)} ${n(y + height - shape.y(t) * height)}`
  const points = Array.from({ length: STEPS + 1 }, (_, i) => at(i / STEPS))
  const goal =
    shape.goal === undefined
      ? ''
      : h('path', {
          d: `M${n(x)} ${n(y + height - shape.goal * height)}H${n(x + w)}`,
          stroke: ink,
          'stroke-opacity': 0.35,
          'stroke-width': 1,
          'stroke-dasharray': '2 2.5',
        })
  return h(
    'g',
    { class: 'trend' },
    axes &&
      h('path', {
        d: `M${n(x)} ${n(y - 1)}V${n(y + height + 1)}H${n(x + w + 1)}`,
        fill: 'none',
        stroke: tokens.fg,
        'stroke-opacity': 0.22,
        'stroke-width': 1,
      }),
    goal,
    h('path', {
      d: `M${points.join('L')}`,
      fill: 'none',
      stroke: ink,
      'stroke-width': 1.7,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    }),
  )
}
