import type { Point } from '../../core/geometry.ts'
import { n } from '../../core/svg.ts'
import { wrapAngle } from './vec.ts'

/**
 * Links drawn as single circle arcs. An arc meets its chord at the same angle at both ends, so a
 * link asked for two different end headings takes the arc that splits the difference; where both
 * headings come from one circle, the arc lies on it. Positions along a curve are given as t, the
 * fraction of its length.
 */

/** A circle arc, or a straight line when `center` is null. */
export interface Curve {
  p0: Point
  p1: Point
  center: Point | null
  r: number
  /** Angle of `p0` about the center. */
  start: number
  /** Signed turn about the center: positive runs clockwise on screen. */
  sweep: number
  length: number
}

/** The most a curve's heading at either end may turn from its chord: a little past square. */
const MAX_TURN = 1.62

/**
 * The arc from `from` to `to` whose turn from the chord is the mean of what `start` and `end`
 * ask for (radians), held within MAX_TURN.
 */
export function curveBetween({
  from,
  to,
  start,
  end,
  stretch = 1,
}: {
  from: Point
  to: Point
  start: number
  end: number
  /** Scales the turn from the chord, so the arc bulges further than its circle would. */
  stretch?: number
}): Curve {
  const chord = Math.hypot(to.x - from.x, to.y - from.y)
  const angle = Math.atan2(to.y - from.y, to.x - from.x)
  const asked = (wrapAngle(start - angle) - wrapAngle(end - angle)) / 2
  const turn = Math.max(-MAX_TURN, Math.min(MAX_TURN, asked)) * stretch
  if (Math.abs(turn) < 1e-4 || chord < 1e-6)
    return { p0: from, p1: to, center: null, r: 0, start: 0, sweep: 0, length: chord }
  const r = chord / (2 * Math.abs(Math.sin(turn)))
  const heading = angle + turn
  const side = Math.sign(turn)
  const center = {
    x: from.x + Math.sin(heading) * r * side,
    y: from.y - Math.cos(heading) * r * side,
  }
  const sweep = -2 * turn
  return {
    p0: from,
    p1: to,
    center,
    r,
    start: Math.atan2(from.y - center.y, from.x - center.x),
    sweep,
    length: r * Math.abs(sweep),
  }
}

export function curvePoint({ curve, t }: { curve: Curve; t: number }): Point {
  const { p0, p1, center, r, start, sweep } = curve
  if (!center) return { x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t }
  const angle = start + sweep * t
  return { x: center.x + Math.cos(angle) * r, y: center.y + Math.sin(angle) * r }
}

/** Direction of travel at t, in radians. */
export function curveHeading({ curve, t }: { curve: Curve; t: number }): number {
  const { p0, p1, center, start, sweep } = curve
  if (!center) return Math.atan2(p1.y - p0.y, p1.x - p0.x)
  return start + sweep * t + (Math.sign(sweep) * Math.PI) / 2
}

/** SVG path data for the curve between two positions. */
export function curvePath({ curve, t0, t1 }: { curve: Curve; t0: number; t1: number }): string {
  const a = curvePoint({ curve, t: t0 })
  const b = curvePoint({ curve, t: t1 })
  const move = `M${n(a.x)} ${n(a.y)}`
  if (!curve.center) return `${move}L${n(b.x)} ${n(b.y)}`
  const sweep = curve.sweep * (t1 - t0)
  const large = Math.abs(sweep) > Math.PI ? 1 : 0
  const clockwise = sweep > 0 ? 1 : 0
  return `${move}A${n(curve.r)} ${n(curve.r)} 0 ${large} ${clockwise} ${n(b.x)} ${n(b.y)}`
}

export function curveLength(curve: Curve): number {
  return curve.length
}

/** The step in t that covers `distance` along the curve. */
export function curveStep({ curve, distance }: { curve: Curve; distance: number }): number {
  return distance / Math.max(1e-6, curve.length)
}

/** Points along the curve between two positions, for collision checks. */
export function curveSamples({
  curve,
  t0,
  t1,
  spacing = 6,
}: {
  curve: Curve
  t0: number
  t1: number
  spacing?: number
}): Point[] {
  const count = Math.max(2, Math.ceil((curve.length * Math.abs(t1 - t0)) / spacing))
  return Array.from({ length: count + 1 }, (_, i) =>
    curvePoint({ curve, t: t0 + ((t1 - t0) * i) / count }),
  )
}

/** First t (scanning from `from` toward `to`) where the curve leaves the region `within` tests. */
export function curveExit({
  curve,
  within,
  from,
  to,
}: {
  curve: Curve
  within: (p: Point) => boolean
  from: number
  to: number
}): number {
  const steps = 64
  let inside = from
  let outside = to
  for (let i = 0; i <= steps; i++) {
    const t = from + ((to - from) * i) / steps
    if (!within(curvePoint({ curve, t }))) {
      outside = t
      break
    }
    inside = t
  }
  for (let i = 0; i < 20; i++) {
    const mid = (inside + outside) / 2
    if (within(curvePoint({ curve, t: mid }))) inside = mid
    else outside = mid
  }
  return outside
}
