import { curveCatmullRom, curveCatmullRomClosed, line } from 'd3-shape'
import type { Rng } from './rng.ts'
import { n } from './svg.ts'

export interface Point {
  x: number
  y: number
}

const open = line<Point>()
  .x((p) => p.x)
  .y((p) => p.y)
  .curve(curveCatmullRom.alpha(0.5))
const closed = line<Point>()
  .x((p) => p.x)
  .y((p) => p.y)
  .curve(curveCatmullRomClosed.alpha(0.5))

/** A smooth path through every point (centripetal Catmull-Rom: no cusps or loops). */
export function smooth({ points, close = false }: { points: Point[]; close?: boolean }): string {
  return (close ? closed(points) : open(points)) ?? ''
}

export function distance({ from, to }: { from: Point; to: Point }): number {
  return Math.hypot(to.x - from.x, to.y - from.y)
}

export function polar({
  cx,
  cy,
  r,
  angle,
}: {
  cx: number
  cy: number
  r: number
  angle: number
}): Point {
  return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) }
}

export interface Cubic {
  from: Point
  c1: Point
  c2: Point
  to: Point
}

export function cubicAt({ curve, t }: { curve: Cubic; t: number }): Point {
  const u = 1 - t
  const { from, c1, c2, to } = curve
  return {
    x: u * u * u * from.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * to.x,
    y: u * u * u * from.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * to.y,
  }
}

export function sampleCubic({ curve, steps = 24 }: { curve: Cubic; steps?: number }): Point[] {
  return Array.from({ length: steps + 1 }, (_, i) => cubicAt({ curve, t: i / steps }))
}

export function cubicPath(curve: Cubic): string {
  const { from, c1, c2, to } = curve
  return `M${n(from.x)} ${n(from.y)}C${n(c1.x)} ${n(c1.y)} ${n(c2.x)} ${n(c2.y)} ${n(to.x)} ${n(to.y)}`
}

/**
 * A filled ribbon along a centerline whose width changes point by point: the tapered branch of
 * an organic mind map, or a flow that narrows. Both ends come out rounded.
 */
export function ribbon({ points, widths }: { points: Point[]; widths: number[] }): string {
  const left: Point[] = []
  const right: Point[] = []
  points.forEach((p, i) => {
    const prev = points[Math.max(0, i - 1)]
    const next = points[Math.min(points.length - 1, i + 1)]
    const dx = next.x - prev.x
    const dy = next.y - prev.y
    const len = Math.hypot(dx, dy) || 1
    const half = widths[i] / 2
    left.push({ x: p.x - (dy / len) * half, y: p.y + (dx / len) * half })
    right.push({ x: p.x + (dy / len) * half, y: p.y - (dx / len) * half })
  })
  return smooth({ points: [...left, ...right.reverse()], close: true })
}

/** Width that eases from `start` to `end` along a branch, staying full a while before thinning. */
export function taper({
  start,
  end,
  steps,
}: {
  start: number
  end: number
  steps: number
}): number[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps
    const eased = t * t * (3 - 2 * t)
    return start + (end - start) * eased
  })
}

export interface Arc {
  d: string
  control: Point
  /** The point halfway along the curve. */
  mid: Point
  /** Direction of travel where the curve arrives at `to`, in radians. */
  endAngle: number
}

/**
 * A gentle quadratic arc from `from` to `to`, bowed sideways by `bulge` times its length.
 * Positive bulge bows to the left of the direction of travel (in screen coordinates).
 */
export function arc({ from, to, bulge }: { from: Point; to: Point; bulge: number }): Arc {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const control = { x: (from.x + to.x) / 2 + dy * bulge, y: (from.y + to.y) / 2 - dx * bulge }
  const mid = {
    x: 0.25 * from.x + 0.5 * control.x + 0.25 * to.x,
    y: 0.25 * from.y + 0.5 * control.y + 0.25 * to.y,
  }
  return {
    d: `M${n(from.x)} ${n(from.y)}Q${n(control.x)} ${n(control.y)} ${n(to.x)} ${n(to.y)}`,
    control,
    mid,
    endAngle: Math.atan2(to.y - control.y, to.x - control.x),
  }
}

/** A soft arrowhead with a notched back, tip at `tip`, pointing along `angle` (radians). */
export function arrowHead({
  tip,
  angle,
  size,
}: {
  tip: Point
  angle: number
  size: number
}): string {
  const corner = (side: number) => {
    const a = angle + Math.PI - side * 0.42
    return { x: tip.x + Math.cos(a) * size, y: tip.y + Math.sin(a) * size }
  }
  const l = corner(1)
  const r = corner(-1)
  const notch = {
    x: tip.x - Math.cos(angle) * size * 0.62,
    y: tip.y - Math.sin(angle) * size * 0.62,
  }
  return `M${n(tip.x)} ${n(tip.y)}L${n(l.x)} ${n(l.y)}Q${n(notch.x)} ${n(notch.y)} ${n(r.x)} ${n(r.y)}Z`
}

/**
 * A closed polygon with every corner rounded by up to `r` (less where the sides are short).
 * Straight sides stay straight, unlike `smooth`, which bulges between points.
 */
export function roundedPolygon({ points, r }: { points: Point[]; r: number }): string {
  if (r <= 0) return `M${points.map((p) => `${n(p.x)} ${n(p.y)}`).join('L')}Z`
  const count = points.length
  const corners = points.map((p, i) => {
    const prev = points[(i - 1 + count) % count]
    const next = points[(i + 1) % count]
    const inLen = Math.hypot(p.x - prev.x, p.y - prev.y) || 1
    const outLen = Math.hypot(next.x - p.x, next.y - p.y) || 1
    const rr = Math.min(r, inLen / 2, outLen / 2)
    return {
      start: { x: p.x - ((p.x - prev.x) / inLen) * rr, y: p.y - ((p.y - prev.y) / inLen) * rr },
      corner: p,
      end: { x: p.x + ((next.x - p.x) / outLen) * rr, y: p.y + ((next.y - p.y) / outLen) * rr },
    }
  })
  let d = `M${n(corners[0].end.x)} ${n(corners[0].end.y)}`
  for (let i = 1; i <= count; i++) {
    const { start, corner, end } = corners[i % count]
    d += `L${n(start.x)} ${n(start.y)}Q${n(corner.x)} ${n(corner.y)} ${n(end.x)} ${n(end.y)}`
  }
  return `${d}Z`
}

/** A rounded rectangle path. */
export function roundedRect({
  x,
  y,
  w,
  h,
  r,
}: {
  x: number
  y: number
  w: number
  h: number
  r: number
}): string {
  const rr = Math.min(r, w / 2, h / 2)
  if (rr <= 0) return `M${n(x)} ${n(y)}H${n(x + w)}V${n(y + h)}H${n(x)}Z`
  return (
    `M${n(x + rr)} ${n(y)}H${n(x + w - rr)}A${n(rr)} ${n(rr)} 0 0 1 ${n(x + w)} ${n(y + rr)}` +
    `V${n(y + h - rr)}A${n(rr)} ${n(rr)} 0 0 1 ${n(x + w - rr)} ${n(y + h)}` +
    `H${n(x + rr)}A${n(rr)} ${n(rr)} 0 0 1 ${n(x)} ${n(y + h - rr)}` +
    `V${n(y + rr)}A${n(rr)} ${n(rr)} 0 0 1 ${n(x + rr)} ${n(y)}Z`
  )
}

/**
 * An organic blob around an ellipse: points around it nudged in and out, joined smoothly.
 * `wobble` is the nudge as a share of the radius; 0.04–0.08 reads as hand-made, not wobbly.
 */
export function blob({
  cx,
  cy,
  rx,
  ry,
  rng,
  wobble = 0.06,
  count = 9,
}: {
  cx: number
  cy: number
  rx: number
  ry: number
  rng: Rng
  wobble?: number
  count?: number
}): string {
  const start = rng.next() * Math.PI * 2
  const points = Array.from({ length: count }, (_, i) => {
    const angle = start + (i / count) * Math.PI * 2
    const k = 1 + (rng.next() * 2 - 1) * wobble
    return { x: cx + Math.cos(angle) * rx * k, y: cy + Math.sin(angle) * ry * k }
  })
  return smooth({ points, close: true })
}

/**
 * A rounded rectangle whose sides bow very slightly and whose corners vary, so a row of boxes
 * reads as drawn rather than stamped. A true rounded rectangle when `wobble` is 0.
 */
export function softRect({
  x,
  y,
  w,
  h,
  r,
  rng,
  wobble = 1,
}: {
  x: number
  y: number
  w: number
  h: number
  r: number
  rng: Rng
  wobble?: number
}): string {
  if (!wobble) return roundedRect({ x, y, w, h, r })
  const j = () => (rng.next() * 2 - 1) * wobble
  const rr = Math.min(r, w / 2, h / 2)
  const k = rr * 0.29
  const bow = wobble * 0.6
  const points: Point[] = [
    { x: x + rr + j(), y: y + j() },
    { x: x + w / 2 + j(), y: y - bow + j() * 0.5 },
    { x: x + w - rr + j(), y: y + j() },
    { x: x + w - k, y: y + k },
    { x: x + w + j(), y: y + rr + j() },
    { x: x + w + bow + j() * 0.5, y: y + h / 2 + j() },
    { x: x + w + j(), y: y + h - rr + j() },
    { x: x + w - k, y: y + h - k },
    { x: x + w - rr + j(), y: y + h + j() },
    { x: x + w / 2 + j(), y: y + h + bow + j() * 0.5 },
    { x: x + rr + j(), y: y + h + j() },
    { x: x + k, y: y + h - k },
    { x: x + j(), y: y + h - rr + j() },
    { x: x - bow + j() * 0.5, y: y + h / 2 + j() },
    { x: x + j(), y: y + rr + j() },
    { x: x + k, y: y + k },
  ]
  return smooth({ points, close: true })
}

/** Where a ray from a box's center toward `toward` leaves the box (for attaching edges). */
export function boxExit({
  center,
  w,
  h,
  toward,
  pad = 0,
}: {
  center: Point
  w: number
  h: number
  toward: Point
  pad?: number
}): Point {
  const dx = toward.x - center.x
  const dy = toward.y - center.y
  if (!dx && !dy) return center
  const sx = (w / 2 + pad) / Math.abs(dx || 1e-9)
  const sy = (h / 2 + pad) / Math.abs(dy || 1e-9)
  const s = Math.min(sx, sy)
  return { x: center.x + dx * s, y: center.y + dy * s }
}

/** Where a ray from an ellipse's center toward `toward` leaves the ellipse. */
export function ellipseExit({
  center,
  rx,
  ry,
  toward,
  pad = 0,
}: {
  center: Point
  rx: number
  ry: number
  toward: Point
  pad?: number
}): Point {
  const angle = Math.atan2(toward.y - center.y, toward.x - center.x)
  return { x: center.x + Math.cos(angle) * (rx + pad), y: center.y + Math.sin(angle) * (ry + pad) }
}
