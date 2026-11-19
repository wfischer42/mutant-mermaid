import type { Point } from '../../core/geometry.ts'

/** Small vector and box helpers for the systems layouts. */

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export function add({ a, b }: { a: Point; b: Point }): Point {
  return { x: a.x + b.x, y: a.y + b.y }
}

export function sub({ a, b }: { a: Point; b: Point }): Point {
  return { x: a.x - b.x, y: a.y - b.y }
}

export function scale({ p, k }: { p: Point; k: number }): Point {
  return { x: p.x * k, y: p.y * k }
}

export function len(p: Point): number {
  return Math.hypot(p.x, p.y)
}

export function unit(p: Point): Point {
  const l = Math.hypot(p.x, p.y)
  return l ? { x: p.x / l, y: p.y / l } : { x: 0, y: 0 }
}

export function centroid(points: Point[]): Point {
  if (!points.length) return { x: 0, y: 0 }
  const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 })
  return { x: sum.x / points.length, y: sum.y / points.length }
}

/** A box centered on a point. */
export function boxAt({ center, w, h }: { center: Point; w: number; h: number }): Box {
  return { x: center.x - w / 2, y: center.y - h / 2, w, h }
}

export function inflate({ box, pad }: { box: Box; pad: number }): Box {
  return { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 }
}

export function contains({ box, p }: { box: Box; p: Point }): boolean {
  return p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h
}

/** Area two boxes share, 0 when apart. */
export function overlap({ a, b }: { a: Box; b: Box }): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

/** Twice the signed area of a polygon; positive when it runs clockwise on screen (y down). */
export function signedArea(points: Point[]): number {
  let sum = 0
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length]
    sum += p.x * q.y - q.x * p.y
  })
  return sum
}

/** The bounding box of boxes and points together. */
export function bounds({ boxes, points }: { boxes: Box[]; points: Point[] }): Box {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const b of boxes) {
    x0 = Math.min(x0, b.x)
    y0 = Math.min(y0, b.y)
    x1 = Math.max(x1, b.x + b.w)
    y1 = Math.max(y1, b.y + b.h)
  }
  for (const p of points) {
    x0 = Math.min(x0, p.x)
    y0 = Math.min(y0, p.y)
    x1 = Math.max(x1, p.x)
    y1 = Math.max(y1, p.y)
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 0, h: 0 }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** Wraps an angle into (-π, π]. */
export function wrapAngle(angle: number): number {
  let a = angle
  while (a <= -Math.PI) a += Math.PI * 2
  while (a > Math.PI) a -= Math.PI * 2
  return a
}

/** Free-spot search: the candidate with the lowest cost, trying rings of points around `center`. */
export function bestSpot({
  center,
  cost,
  step = 8,
  rings = 10,
}: {
  center: Point
  cost: (p: Point) => number
  step?: number
  rings?: number
}): Point {
  let best = center
  let bestCost = cost(center)
  for (let ring = 1; ring <= rings && bestCost > 0; ring++) {
    const count = 8 + ring * 4
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + ring * 0.37
      const p = {
        x: center.x + Math.cos(angle) * ring * step,
        y: center.y + Math.sin(angle) * ring * step,
      }
      const c = cost(p) + ring * 0.5
      if (c < bestCost) {
        bestCost = c
        best = p
      }
    }
  }
  return best
}

/**
 * The circle that best fits `points` (through all three when there are three), by least squares
 * on x² + y² + Dx + Ey + F = 0. Null for fewer than three points or a straight line.
 */
export function fitCircle(points: Point[]): { center: Point; r: number } | null {
  if (points.length < 3) return null
  const m = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ]
  for (const { x, y } of points) {
    const row = [x, y, 1]
    const rhs = -(x * x + y * y)
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) m[i][j] += row[i] * row[j]
      m[i][3] += row[i] * rhs
    }
  }
  const solved = solve3(m)
  if (!solved) return null
  const [d, e, f] = solved
  const center = { x: -d / 2, y: -e / 2 }
  return { center, r: Math.sqrt(Math.max(0, center.x ** 2 + center.y ** 2 - f)) }
}

/** Solves a 3×3 system given as augmented rows, by Cramer's rule; null when singular. */
function solve3(m: number[][]): number[] | null {
  const det = (c: number[][]) =>
    c[0][0] * (c[1][1] * c[2][2] - c[1][2] * c[2][1]) -
    c[0][1] * (c[1][0] * c[2][2] - c[1][2] * c[2][0]) +
    c[0][2] * (c[1][0] * c[2][1] - c[1][1] * c[2][0])
  const base = det(m)
  if (Math.abs(base) < 1e-6 * Math.max(1, Math.abs(m[0][0] * m[1][1] * m[2][2]))) return null
  return [0, 1, 2].map((k) => det(m.map((row) => row.map((v, j) => (j === k ? row[3] : v)))) / base)
}
