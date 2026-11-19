import { arrowHead, type Point } from '../../core/geometry.ts'
import { target } from '../../core/hooks.ts'
import { h, n, text } from '../../core/svg.ts'
import type { TextKit } from '../../core/text.ts'
import type { Swatch, Tokens } from '../../theme/index.ts'
import { OUTLINE, toned, WEIGHT } from '../../theme/index.ts'
import type { LoopKind } from './model.ts'
import { drawTrend, type Trend } from './trend.ts'

/** Marks shared by both systems diagrams: loop badges, polarity signs and delay ticks. */

/** Loop hues, clay for reinforcing and slate for balancing, kept close to neutral. */
const LOOP_HUE = { R: 55, B: 230 }
const LOOP_VIVID = 0.4

/**
 * The swatch for a loop: one per kind, so color says reinforcing or balancing and the shapes and
 * names tell loops apart.
 */
export function loopSwatch({ tokens, kind }: { tokens: Tokens; kind: LoopKind }): Swatch {
  return toned({ tokens, hue: LOOP_HUE[kind], vivid: LOOP_VIVID })
}

export const BADGE = 14
export const LOOP_RING = 21

export interface Badge {
  tag: string
  name: string[]
  clockwise: boolean
  swatch: Swatch
  /**
   * Behaviour over time: when set, the marker is a disc holding its sketch, its edge an arrow
   * turning the loop's way, with no tag shown.
   */
  trend?: Trend
}

/** Size of a loop marker with its name, centered on the badge horizontally. */
export function badgeSize({ badge, kit, size }: { badge: Badge; kit: TextKit; size: number }): {
  w: number
  h: number
  above: number
} {
  const nameW = Math.max(
    0,
    ...badge.name.map((line) => kit.width(line, { size, weight: WEIGHT.heading })),
  )
  const nameH = badge.name.length ? badge.name.length * kit.lineHeight({ size }) + 6 : 0
  return {
    w: Math.max(LOOP_RING * 2 + 10, nameW + 8),
    h: LOOP_RING * 2 + 8 + nameH,
    above: LOOP_RING + 4,
  }
}

/** A loop's sketch in a disc of its color, sized to the ring a plain marker draws. */
function trendDisc({ badge, at, tokens }: { badge: Badge; at: Point; tokens: Tokens }): string[] {
  const sw = badge.swatch
  if (!badge.trend) return []
  const r = LOOP_RING
  const dir = badge.clockwise ? 1 : -1
  const begin = -Math.PI / 2 + dir * 0.4
  const end = begin + dir * (Math.PI * 2 - 0.95)
  const p0 = { x: at.x + Math.cos(begin) * r, y: at.y + Math.sin(begin) * r }
  const p1 = { x: at.x + Math.cos(end) * r, y: at.y + Math.sin(end) * r }
  const heading = Math.atan2(Math.cos(end) * dir, -Math.sin(end) * dir)
  const tip = { x: p1.x + Math.cos(heading) * 4, y: p1.y + Math.sin(heading) * 4 }
  return [
    h('circle', { cx: at.x, cy: at.y, r: r + 4, fill: tokens.bg, opacity: 0.85 }),
    h('circle', { cx: at.x, cy: at.y, r, fill: sw.fill }),
    h('path', {
      d: `M${n(p0.x)} ${n(p0.y)}A${n(r)} ${n(r)} 0 1 ${dir > 0 ? 1 : 0} ${n(p1.x)} ${n(p1.y)}`,
      fill: 'none',
      stroke: sw.stroke,
      'stroke-width': 1.8,
      'stroke-linecap': 'round',
    }),
    h('path', { d: arrowHead({ tip, angle: heading, size: 7 }), fill: sw.strong }),
    drawTrend({ trend: badge.trend, cx: at.x, cy: at.y, w: 26, h: 13, ink: sw.strong, tokens, axes: false }),
  ]
}

/**
 * A loop marker: the R/B tag in a small circle, ringed by a circular arrow that turns the way
 * the loop runs, with the loop's name beneath.
 */
export function drawBadge({
  badge,
  at,
  kit,
  tokens,
  scale = 1,
}: {
  badge: Badge
  at: Point
  kit: TextKit
  tokens: Tokens
  scale?: number
}): string {
  const { swatch: sw } = badge
  const r = LOOP_RING * scale
  const dir = badge.clockwise ? 1 : -1
  const begin = -Math.PI / 2 + dir * 0.55
  const sweep = Math.PI * 2 - 1.25
  const end = begin + dir * sweep
  const p0 = { x: at.x + Math.cos(begin) * r, y: at.y + Math.sin(begin) * r }
  const p1 = { x: at.x + Math.cos(end) * r, y: at.y + Math.sin(end) * r }
  const heading = Math.atan2(Math.cos(end) * dir, -Math.sin(end) * dir)
  const tip = { x: p1.x + Math.cos(heading) * 3, y: p1.y + Math.sin(heading) * 3 }
  const tagSize = 13 * scale
  const nameSize = 12.5
  const ring = [
    h('circle', { cx: at.x, cy: at.y, r: r + 5, fill: tokens.bg, opacity: 0.85 }),
    h('path', {
      d: `M${n(p0.x)} ${n(p0.y)}A${n(r)} ${n(r)} 0 1 ${dir > 0 ? 1 : 0} ${n(p1.x)} ${n(p1.y)}`,
      fill: 'none',
      stroke: sw.stroke,
      'stroke-width': 2.2 * scale,
      'stroke-linecap': 'round',
    }),
    h('path', { d: arrowHead({ tip, angle: heading, size: 8 * scale }), fill: sw.strong }),
    h('circle', {
      cx: at.x,
      cy: at.y,
      r: BADGE * scale,
      fill: sw.fill,
      stroke: sw.stroke,
      'stroke-width': OUTLINE.thin,
    }),
    text({
      x: at.x,
      y: at.y,
      lines: [badge.tag],
      size: tagSize,
      weight: WEIGHT.heading,
      fill: sw.strong,
      lineHeight: kit.lineHeight({ size: tagSize }),
      shift: kit.baselineShift({ size: tagSize }),
    }),
  ]
  const parts = badge.trend ? trendDisc({ badge, at, tokens }) : ring
  const nameTop = at.y + r + 8
  const nameH = badge.name.length * kit.lineHeight({ size: nameSize })
  if (badge.name.length)
    parts.push(
      text({
        x: at.x,
        y: nameTop + nameH / 2,
        lines: badge.name,
        size: nameSize,
        weight: WEIGHT.heading,
        fill: sw.strong,
        lineHeight: kit.lineHeight({ size: nameSize }),
        shift: kit.baselineShift({ size: nameSize }),
      }),
    )
  return h(
    'g',
    { ...target({ id: badge.tag, kind: 'loop', tint: sw.strong }), class: 'loop' },
    ...parts,
  )
}

/** A + or − sign on a small halo. */
export function drawSign({
  polarity,
  at,
  color,
  tokens,
  kit,
}: {
  polarity: '+' | '-'
  at: Point
  color: string
  tokens: Tokens
  kit: TextKit
}): string {
  const size = 16
  return h(
    'g',
    {},
    h('circle', { cx: at.x, cy: at.y, r: 8.5, fill: tokens.bg, opacity: 0.9 }),
    text({
      x: at.x,
      y: at.y,
      lines: [polarity === '+' ? '+' : '−'],
      size,
      weight: WEIGHT.heading,
      fill: color,
      lineHeight: kit.lineHeight({ size }),
      shift: kit.baselineShift({ size }) - 0.5,
    }),
  )
}

/** Two short strokes across a link, the convention for a delay. */
export function drawDelay({
  at,
  heading,
  color,
  tokens,
}: {
  at: Point
  heading: number
  color: string
  tokens: Tokens
}): string {
  const tx = Math.cos(heading)
  const ty = Math.sin(heading)
  const nx = -ty
  const ny = tx
  const tick = (offset: number) => {
    const c = { x: at.x + tx * offset, y: at.y + ty * offset }
    return `M${n(c.x - nx * 8)} ${n(c.y - ny * 8)}L${n(c.x + nx * 8)} ${n(c.y + ny * 8)}`
  }
  return h(
    'g',
    {},
    h('path', { d: tick(0), stroke: tokens.bg, 'stroke-width': 9, 'stroke-linecap': 'round' }),
    h('path', {
      d: `${tick(-2.6)}${tick(2.6)}`,
      stroke: color,
      'stroke-width': 2.2,
      'stroke-linecap': 'round',
    }),
  )
}
