import type { Point } from '../../core/geometry.ts'
import { n } from '../../core/svg.ts'

/** Drops repeated points and middle points of straight runs. */
export function simplify(points: Point[]): Point[] {
  const out: Point[] = []
  for (const p of points) {
    const last = out[out.length - 1]
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < 0.5) continue
    const before = out[out.length - 2]
    if (before && last && collinear({ a: before, b: last, c: p })) out[out.length - 1] = p
    else out.push(p)
  }
  return out
}

function collinear({ a, b, c }: { a: Point; b: Point; c: Point }): boolean {
  return Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) < 0.5
}

// How far the handles of a single turn reach along its legs: a little more than a circle's (0.55).
const HANDLE = 0.62
// How far an edge runs straight before its end, so a marker never sits on a bend.
const LEAD = 6
// How far along the flow each half of a jog's S may reach, per unit of its sideways step.
const JOG_REACH = 1.2
// A sideways step below this many units is drawn straight.
const TINY_JOG = 10
// A jog that steps back less than this folds into the one before it (see `unzig`).
const ZIG = 20

/** A corner of the route, or two opposite corners (a jog) drawn as one S. */
interface Bend {
  kind: 'turn' | 'jog'
  /** The first corner's index; a jog's second corner is the next point. */
  at: number
}

interface Seg {
  len: number
  dx: number
  dy: number
  axial: boolean
}

function segOf(points: Point[], i: number): Seg {
  const a = points[i]
  const b = points[i + 1]
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
  const axial = Math.abs(b.x - a.x) < 0.5 || Math.abs(b.y - a.y) < 0.5
  return { len, dx: (b.x - a.x) / len, dy: (b.y - a.y) / len, axial }
}

/** Whether the route turns a right angle at point i. */
function isCorner(points: Point[], i: number): boolean {
  if (i <= 0 || i >= points.length - 1) return false
  const a = segOf(points, i - 1)
  const b = segOf(points, i)
  return a.axial && b.axial && Math.abs(a.dx * b.dx + a.dy * b.dy) < 0.01
}

/** Whether corners i and i + 1 step the route sideways, leaving it heading the way it came in. */
function isJog(points: Point[], i: number): boolean {
  if (!isCorner(points, i + 1)) return false
  const a = segOf(points, i - 1)
  const b = segOf(points, i + 1)
  return a.dx * b.dx + a.dy * b.dy > 0.99
}

/**
 * Folds a zigzag, a jog straight after another that steps a little way back, into one jog of
 * their net step at the first one, so a nearly straight route doesn't wander out and back. Only
 * a small step back folds: moving the run between them any further could cross a node.
 */
function unzig(points: Point[]): Point[] {
  const out = points.slice()
  for (let i = 1; i + 4 < out.length; i++) {
    if (!(isJog(out, i) && isJog(out, i + 2))) continue
    const [a, b, c, d] = [out[i], out[i + 1], out[i + 2], out[i + 3]]
    const back = (b.x - a.x) * (d.x - c.x) + (b.y - a.y) * (d.y - c.y) < 0
    const small = Math.min(Math.hypot(b.x - a.x, b.y - a.y), Math.hypot(d.x - c.x, d.y - c.y)) < ZIG
    if (!(back && small)) continue
    out.splice(i + 1, 2, { x: b.x + d.x - c.x, y: b.y + d.y - c.y })
    i--
  }
  return simplify(out)
}

function findBends(points: Point[]): Bend[] {
  const bends: Bend[] = []
  for (let i = 1; i < points.length - 1; i++) {
    if (!isCorner(points, i)) continue
    const jog = isJog(points, i)
    bends.push({ kind: jog ? 'jog' : 'turn', at: i })
    if (jog) i++
  }
  return bends
}

function step({ p, seg, by }: { p: Point; seg: Seg; by: number }): Point {
  return { x: p.x + seg.dx * by, y: p.y + seg.dy * by }
}

/** A straight run to `to`, or a cubic to it when it has handles. */
interface Piece {
  to: Point
  h1?: Point
  h2?: Point
}

function cubic({ from, h1, h2, to }: { from: Point; h1: Point; h2: Point; to: Point }): Piece[] {
  return [{ to: from }, { to, h1, h2 }]
}

/** Leg lengths for a turn, each at most twice the other so the curve doesn't go lopsided. */
function balance([a, b]: [number, number]): [number, number] {
  return [Math.min(a, b * 2), Math.min(b, a * 2)]
}

/**
 * A jog's S, which runs along the flow at most a little further than it steps sideways. A step
 * too small to read as one is drawn as a straight slant across both legs instead of a wobble.
 */
function jogPath({ points, at, legs }: { points: Point[]; at: number; legs: [number, number] }): Piece[] {
  const into = segOf(points, at - 1)
  const side = segOf(points, at).len
  if (side < TINY_JOG) return [{ to: step({ p: points[at + 1], seg: segOf(points, at + 1), by: legs[1] }) }]
  const reach = Math.max(side * JOG_REACH, 40)
  const from = step({ p: points[at], seg: into, by: -Math.min(legs[0], reach) })
  const to = step({ p: points[at + 1], seg: segOf(points, at + 1), by: Math.min(legs[1], reach) })
  const along = Math.abs((to.x - from.x) * into.dx + (to.y - from.y) * into.dy) / 2
  return cubic({
    from,
    h1: step({ p: from, seg: into, by: along }),
    h2: step({ p: to, seg: into, by: -along }),
    to,
  })
}

function turnPath({ points, at, legs }: { points: Point[]; at: number; legs: [number, number] }): Piece[] {
  const into = segOf(points, at - 1)
  const out = segOf(points, at)
  const [inLen, outLen] = balance(legs)
  const from = step({ p: points[at], seg: into, by: -inLen })
  const to = step({ p: points[at], seg: out, by: outLen })
  return cubic({
    from,
    h1: step({ p: from, seg: into, by: inLen * HANDLE }),
    h2: step({ p: to, seg: out, by: -outLen * HANDLE }),
    to,
  })
}

/**
 * How much of segment `s` the bend at one end may use: half when another bend shares it, or
 * all of it when its other end, `far`, is an end of the route (less the lead into a marker).
 */
function room({
  points,
  bent,
  s,
  far,
}: {
  points: Point[]
  bent: Set<number>
  s: number
  far: number
}): number {
  const { len } = segOf(points, s)
  if (bent.has(far)) return len / 2
  return Math.max(0, len - (far === points.length - 1 ? LEAD : 0))
}

/**
 * An orthogonal polyline drawn with curves, after Pele: a jog (two opposite turns, the route
 * stepping sideways) becomes one S that leaves and arrives along the flow, and any other corner
 * turns as widely as its legs allow, taking all of a leg that ends at a node and half of a leg
 * it shares with another bend. Diagonal segments stay straight.
 */
function curvePieces(points: Point[]): Piece[] {
  const bends = findBends(points)
  const bent = new Set(bends.flatMap((b) => (b.kind === 'jog' ? [b.at, b.at + 1] : [b.at])))
  const pieces: Piece[] = []
  let next = 1
  for (const { kind, at } of bends) {
    for (; next < at; next++) pieces.push({ to: points[next] })
    const end = kind === 'jog' ? at + 1 : at
    const legs: [number, number] = [
      room({ points, bent, s: at - 1, far: at - 1 }),
      room({ points, bent, s: end, far: end + 1 }),
    ]
    pieces.push(...(kind === 'jog' ? jogPath({ points, at, legs }) : turnPath({ points, at, legs })))
    next = end + 1
  }
  for (; next < points.length; next++) pieces.push({ to: points[next] })
  return pieces
}

const CURVE_SAMPLES = 12

function cubicAt({ from, piece, t }: { from: Point; piece: Required<Piece>; t: number }): Point {
  const u = 1 - t
  const [a, b, c, d] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t]
  return {
    x: a * from.x + b * piece.h1.x + c * piece.h2.x + d * piece.to.x,
    y: a * from.y + b * piece.h1.y + c * piece.h2.y + d * piece.to.y,
  }
}

/**
 * The route drawn with curves (see `curvePieces`): its SVG path, and the same line as a
 * polyline, sampled along each curve, for placing labels on what is drawn.
 */
export function curve(route: Point[]): { d: string; line: Point[] } {
  if (route.length < 2) return { d: '', line: route }
  const points = unzig(route)
  let d = `M${n(points[0].x)} ${n(points[0].y)}`
  const line = [points[0]]
  for (const piece of curvePieces(points)) {
    const from = line[line.length - 1]
    const { to, h1, h2 } = piece
    if (h1 && h2) {
      d += `C${n(h1.x)} ${n(h1.y)} ${n(h2.x)} ${n(h2.y)} ${n(to.x)} ${n(to.y)}`
      for (let i = 1; i <= CURVE_SAMPLES; i++)
        line.push(cubicAt({ from, piece: { to, h1, h2 }, t: i / CURVE_SAMPLES }))
    } else {
      d += `L${n(to.x)} ${n(to.y)}`
      line.push(to)
    }
  }
  return { d, line }
}

/** The point `fraction` of the way along a polyline, by length. */
export function pointAlong({ points, fraction }: { points: Point[]; fraction: number }): Point {
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y))
  let left = lengths.reduce((a, b) => a + b, 0) * fraction
  for (const [i, len] of lengths.entries()) {
    if (left <= len && len > 0) {
      const t = left / len
      const a = points[i]
      const b = points[i + 1]
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
    }
    left -= len
  }
  return points[points.length - 1]
}

/** Ray parameter where the ray from `from` along (dx, dy) crosses segment a–b, or Infinity. */
function crossing({ from, dir, a, b }: { from: Point; dir: Point; a: Point; b: Point }): number {
  const ex = b.x - a.x
  const ey = b.y - a.y
  const denom = dir.x * ey - dir.y * ex
  if (Math.abs(denom) < 1e-9) return Number.POSITIVE_INFINITY
  const t = ((a.x - from.x) * ey - (a.y - from.y) * ex) / denom
  const u = ((a.x - from.x) * dir.y - (a.y - from.y) * dir.x) / denom
  const onSegment = u >= -1e-6 && u <= 1 + 1e-6
  return onSegment && t > 1e-6 ? t : Number.POSITIVE_INFINITY
}

/** Where the ray from `from` through `to` first crosses the polygon, if it does. */
export function enter({
  from,
  to,
  polygon,
}: {
  from: Point
  to: Point
  polygon: Point[]
}): Point | null {
  const dir = { x: to.x - from.x, y: to.y - from.y }
  const best = Math.min(
    ...polygon.map((a, i) => crossing({ from, dir, a, b: polygon[(i + 1) % polygon.length] })),
  )
  return Number.isFinite(best) ? { x: from.x + dir.x * best, y: from.y + dir.y * best } : null
}

/** Moves the end of a polyline back by `by` along its last segment. */
export function trimEnd({ points, by }: { points: Point[]; by: number }): Point[] {
  const out = points.slice()
  const last = out[out.length - 1]
  const prev = out[out.length - 2]
  const len = Math.hypot(last.x - prev.x, last.y - prev.y)
  if (len < 1e-6) return out
  const k = Math.min(by, len - 0.5) / len
  out[out.length - 1] = { x: last.x - (last.x - prev.x) * k, y: last.y - (last.y - prev.y) * k }
  return out
}

/** Direction of travel along the last segment, in radians. */
export function endAngle(points: Point[]): number {
  const last = points[points.length - 1]
  const prev = points[points.length - 2]
  return Math.atan2(last.y - prev.y, last.x - prev.x)
}
