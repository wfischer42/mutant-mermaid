import type { Point } from '../../core/geometry.ts'
import { n } from '../../core/svg.ts'
import { type Box, contains, wrapAngle } from './vec.ts'

/** A circular arc between two points, trimmed where it leaves and enters two boxes. */
export interface CircleArc {
  center: Point
  r: number
  /** Angle at t = 0. */
  start: number
  /** +1 when the angle grows along the arc (clockwise on screen). */
  sign: number
  /** Angle swept from t = 0 to t = 1. */
  span: number
}

/**
 * The circle arc of radius `r` from `from` to `to` that bows to the left of travel (on screen)
 * when `left` is true, else to the right. `r` is raised to half the chord if it's shorter. With
 * `major`, it takes the long way round, more than a half circle.
 */
export function circleArc({
  from,
  to,
  r,
  left,
  major = false,
}: {
  from: Point
  to: Point
  r: number
  left: boolean
  major?: boolean
}): CircleArc {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const d = Math.hypot(dx, dy) || 1
  const half = d / 2
  const radius = Math.max(r, half * 1.0005)
  const side = left ? 1 : -1
  const normal = { x: (dy / d) * side, y: (-dx / d) * side }
  const back = Math.sqrt(Math.max(0, radius * radius - half * half)) * (major ? -1 : 1)
  const center = {
    x: (from.x + to.x) / 2 - normal.x * back,
    y: (from.y + to.y) / 2 - normal.y * back,
  }
  const start = Math.atan2(from.y - center.y, from.x - center.x)
  const end = Math.atan2(to.y - center.y, to.x - center.x)
  const bow = Math.atan2(normal.y, normal.x)
  const sign = wrapAngle(bow - start) >= 0 ? 1 : -1
  let span = sign * (end - start)
  while (span < 0) span += Math.PI * 2
  while (span > Math.PI * 2) span -= Math.PI * 2
  return { center, r: radius, start, sign, span }
}

export function arcPoint({ arc, t }: { arc: CircleArc; t: number }): Point {
  const angle = arc.start + arc.sign * arc.span * t
  return { x: arc.center.x + Math.cos(angle) * arc.r, y: arc.center.y + Math.sin(angle) * arc.r }
}

/** Direction of travel at t, in radians. */
export function arcHeading({ arc, t }: { arc: CircleArc; t: number }): number {
  const angle = arc.start + arc.sign * arc.span * t
  return Math.atan2(Math.cos(angle) * arc.sign, -Math.sin(angle) * arc.sign)
}

/** The parameter step that covers `distance` along the arc. */
export function arcStep({ arc, distance }: { arc: CircleArc; distance: number }): number {
  return distance / Math.max(1e-6, arc.r * arc.span)
}

/**
 * The arc around `center` from one point on its circle to another, turning clockwise on screen
 * when `sign` is +1. Unlike circleArc it can sweep more than half the circle.
 */
export function arcAround({
  center,
  r,
  from,
  to,
  sign,
}: {
  center: Point
  r: number
  from: Point
  to: Point
  sign: number
}): CircleArc {
  const start = Math.atan2(from.y - center.y, from.x - center.x)
  const end = Math.atan2(to.y - center.y, to.x - center.x)
  let span = sign * (end - start)
  while (span <= 0) span += Math.PI * 2
  while (span > Math.PI * 2) span -= Math.PI * 2
  return { center, r, start, sign, span }
}

/** First t (scanning from `from` toward `to`) where the arc is outside the region `within` tests. */
export function exitWhere({
  arc,
  within,
  from,
  to,
}: {
  arc: CircleArc
  within: (p: Point) => boolean
  from: number
  to: number
}): number {
  const steps = 96
  let inside = from
  let outside = to
  for (let i = 0; i <= steps; i++) {
    const t = from + ((to - from) * i) / steps
    if (!within(arcPoint({ arc, t }))) {
      outside = t
      break
    }
    inside = t
  }
  for (let i = 0; i < 24; i++) {
    const mid = (inside + outside) / 2
    if (within(arcPoint({ arc, t: mid }))) inside = mid
    else outside = mid
  }
  return outside
}

/** First t (scanning from `from` toward `to`) where the arc is outside `box`. */
export function exitT({
  arc,
  box,
  from,
  to,
}: {
  arc: CircleArc
  box: Box
  from: number
  to: number
}): number {
  return exitWhere({ arc, within: (p) => contains({ box, p }), from, to })
}

/** SVG path data for the arc between two parameters. */
export function arcPath({ arc, t0, t1 }: { arc: CircleArc; t0: number; t1: number }): string {
  const a = arcPoint({ arc, t: t0 })
  const b = arcPoint({ arc, t: t1 })
  const large = arc.span * Math.abs(t1 - t0) > Math.PI ? 1 : 0
  const sweep = arc.sign > 0 ? 1 : 0
  return `M${n(a.x)} ${n(a.y)}A${n(arc.r)} ${n(arc.r)} 0 ${large} ${sweep} ${n(b.x)} ${n(b.y)}`
}

/** Points along the arc between two parameters, for collision checks. */
export function arcSamples({
  arc,
  t0,
  t1,
  spacing = 6,
}: {
  arc: CircleArc
  t0: number
  t1: number
  spacing?: number
}): Point[] {
  const length = arc.r * arc.span * Math.abs(t1 - t0)
  const count = Math.max(2, Math.ceil(length / spacing))
  return Array.from({ length: count + 1 }, (_, i) =>
    arcPoint({ arc, t: t0 + ((t1 - t0) * i) / count }),
  )
}
