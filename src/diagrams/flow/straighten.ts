import type { Point } from '../../core/geometry.ts'
import type { Layout, PlacedEdge } from './layout.ts'
import { simplify } from './route.ts'
import type { Box } from './shapes.ts'

/** Routes whose ends are offset sideways by less than this are made straight. */
const NEARLY = 24
/** How far an end stays from a node's corner, which is rounded. */
const CORNER_CLEAR = 14
/** How close two ends on the same side of a node may sit. */
const END_GAP = 12
/** How far a straightened line stays from the nodes it passes. */
const NODE_CLEAR = 6

interface End {
  node: string
  at: Point
}

function within({ v, lo, hi }: { v: number; lo: number; hi: number }): boolean {
  return v >= lo && v <= hi
}

/** Whether a straight run from `a` to `b` stays clear of every box. */
function clearOf({ a, b, boxes }: { a: Point; b: Point; boxes: Box[] }): boolean {
  const [x0, x1] = [Math.min(a.x, b.x), Math.max(a.x, b.x)]
  const [y0, y1] = [Math.min(a.y, b.y), Math.max(a.y, b.y)]
  return boxes.every(
    (r) =>
      x1 < r.x - NODE_CLEAR ||
      x0 > r.x + r.w + NODE_CLEAR ||
      y1 < r.y - NODE_CLEAR ||
      y0 > r.y + r.h + NODE_CLEAR,
  )
}

/**
 * Whether an end can slide along its node's side to `v` (x for a vertical route, y for a
 * horizontal one): far enough from the corners and from the other ends there.
 */
function canSlide({
  box,
  end,
  v,
  vertical,
  ends,
}: {
  box: Box
  end: End
  v: number
  vertical: boolean
  ends: End[]
}): boolean {
  const [lo, len] = vertical ? [box.x, box.w] : [box.y, box.h]
  if (!within({ v, lo: lo + CORNER_CLEAR, hi: lo + len - CORNER_CLEAR })) return false
  const across = (p: Point) => (vertical ? p.y : p.x)
  return ends.every(
    (o) =>
      o === end ||
      o.node !== end.node ||
      Math.abs(across(o.at) - across(end.at)) > 1 ||
      Math.abs((vertical ? o.at.x : o.at.y) - v) >= END_GAP,
  )
}

/**
 * A route that is nearly straight, leaving and arriving along the same axis with its ends only a
 * little apart sideways, made straight by sliding one end along its node's side to line up with
 * the other: the target's end first, else the source's. Left as it is when neither end can move
 * or the straight line would cross another node.
 */
function straightened({
  placed,
  layout,
  ends,
}: {
  placed: PlacedEdge
  layout: Layout
  ends: End[]
}): Point[] {
  const points = simplify(placed.points)
  const [start, end] = [points[0], points[points.length - 1]]
  const from = layout.nodes.get(placed.edge.from)
  const to = layout.nodes.get(placed.edge.to)
  if (!from || !to || points.length < 4) return placed.points
  const vertical = Math.abs(points[1].x - start.x) < 0.5
  const lastVertical = Math.abs(end.x - points[points.length - 2].x) < 0.5
  const off = vertical ? end.x - start.x : end.y - start.y
  if (vertical !== lastVertical || Math.abs(off) >= NEARLY) return placed.points
  const others = [...layout.nodes.entries()]
    .filter(([id]) => id !== placed.edge.from && id !== placed.edge.to)
    .map(([, box]) => box)
  const slide = (p: Point, v: number): Point => (vertical ? { x: v, y: p.y } : { x: p.x, y: v })
  const v0 = vertical ? start.x : start.y
  const v1 = vertical ? end.x : end.y
  const endOf = (node: string, at: Point) => ends.find((e) => e.node === node && e.at === at)
  const tryTo = endOf(placed.edge.to, placed.points[placed.points.length - 1])
  const tryFrom = endOf(placed.edge.from, placed.points[0])
  const toEnd = slide(end, v0)
  const moveEnd = tryTo && canSlide({ box: to, end: tryTo, v: v0, vertical, ends })
  if (moveEnd && clearOf({ a: start, b: toEnd, boxes: others })) {
    tryTo.at = toEnd
    return [start, toEnd]
  }
  const fromStart = slide(start, v1)
  const moveStart = tryFrom && canSlide({ box: from, end: tryFrom, v: v1, vertical, ends })
  if (moveStart && clearOf({ a: fromStart, b: end, boxes: others })) {
    tryFrom.at = fromStart
    return [fromStart, end]
  }
  return placed.points
}

/** Every edge, with each nearly straight route made straight where its ends can slide. */
export function straightenEdges(layout: Layout): PlacedEdge[] {
  const ends: End[] = layout.edges.flatMap(({ edge, points }) =>
    points.length < 2
      ? []
      : [
          { node: edge.from, at: points[0] },
          { node: edge.to, at: points[points.length - 1] },
        ],
  )
  return layout.edges.map((placed) => ({ ...placed, points: straightened({ placed, layout, ends }) }))
}
