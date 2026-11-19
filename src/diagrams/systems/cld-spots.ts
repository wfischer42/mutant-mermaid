import type { Point } from '../../core/geometry.ts'
import { balance } from '../../core/text.ts'
import type { Context } from '../../core/types.ts'
import type { Edge, LoopView } from './cld-edges.ts'
import type { LayoutNode } from './cld-layout.ts'
import { curveHeading, curvePoint, curveSamples, curveStep } from './link-arc.ts'
import { type Badge, badgeSize, LOOP_RING } from './marks.ts'
import {
  type Box,
  bounds,
  boxAt,
  centroid,
  contains,
  inflate,
  overlap,
  signedArea,
  wrapAngle,
} from './vec.ts'

/**
 * Where variable labels, loop markers and polarity signs go. A label sits beside its dot, outside
 * its loops when there's room. A marker belongs inside its loop, and where loops nest, in the
 * part of it no other loop covers; within that, the clearest spot wins.
 */

/** Half the span of a marker's badge, which must sit inside its loop; the name may run over. */
const DISC = LOOP_RING
/** How far a label may sit from its dot: snug first, a little off when links crowd it. */
const GAPS = [6, 16, 28, 44, 60]

export interface Obstacles {
  boxes: Box[]
  points: Point[]
}

export interface Marker {
  view: LoopView
  badge: Badge
  at: Point
  box: Box
}

export function crowding({ box, obstacles }: { box: Box; obstacles: Obstacles }): number {
  let cost = 0
  for (const b of obstacles.boxes) cost += overlap({ a: box, b })
  for (const p of obstacles.points) if (contains({ box, p })) cost += 60
  return cost
}

/** The outline of a loop as drawn: its links' full curves, end to end. */
export function loopOutline({ view, edges }: { view: LoopView; edges: Edge[] }): Point[] {
  return view.loop.cycle.links.flatMap((index) => {
    const edge = edges.find((e) => e.index === index)
    return edge ? curveSamples({ curve: edge.curve, t0: 0, t1: 1, spacing: 10 }) : []
  })
}

/** Even-odd point-in-polygon test. */
export function inside({ p, polygon }: { p: Point; polygon: Point[] }): boolean {
  let hit = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]
    const b = polygon[j]
    const crosses =
      a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y || 1e-9) + a.x
    if (crosses) hit = !hit
  }
  return hit
}

/**
 * Where a polygon's edges cross the row at `y`, for testing many points on that row: a point is
 * `inside` the polygon when an odd number of these lie to its right (see `insideRow`).
 */
export function rowCrossings({ polygon, y }: { polygon: Point[]; y: number }): number[] {
  const xs: number[] = []
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]
    const b = polygon[j]
    if (a.y > y !== b.y > y) xs.push(((b.x - a.x) * (y - a.y)) / (b.y - a.y || 1e-9) + a.x)
  }
  return xs
}

/** The `inside` test for a point at `x` on a row whose `rowCrossings` are `xs`. */
export function insideRow({ xs, x }: { xs: number[]; x: number }): boolean {
  let hit = false
  for (const at of xs) if (x < at) hit = !hit
  return hit
}

function badgeFor({ view, ctx }: { view: LoopView; ctx: Context }): Badge {
  const name = view.loop.name
    ? balance({
        kit: ctx.text,
        text: view.loop.name,
        style: { size: 12.5, weight: 600 },
        max: 120,
      })
    : []
  return {
    tag: view.loop.tag,
    name,
    clockwise: view.clockwise,
    swatch: view.swatch,
    trend: view.trend,
  }
}

interface Shape {
  outline: Point[]
  view: LoopView
}

/** How far outside its loop a marker may go when the inside is crowded. */
const REACH = 70

/**
 * What a marker spot costs: crowding first, then lying outside its loop (more the further out),
 * inside other loops, and far from its loop's middle.
 */
function spotCost({
  p,
  box,
  shape,
  within,
  shared,
  middle,
  obstacles,
}: {
  p: Point
  box: Box
  shape: Shape
  /** Whether `p` is inside its own loop. */
  within: boolean
  /** How many other loops `p` is inside. */
  shared: number
  middle: Point
  obstacles: Obstacles
}): number {
  const gap = within ? 0 : Math.min(...shape.outline.map((q) => Math.hypot(q.x - p.x, q.y - p.y)))
  return (
    (within ? 0 : 300 + gap * 4) +
    shared * 120 +
    crowding({ box: boxAt({ center: p, w: DISC * 2 + 18, h: DISC * 2 + 18 }), obstacles }) * 3 +
    crowding({ box: inflate({ box, pad: 4 }), obstacles }) * 1.5 +
    Math.hypot(p.x - middle.x, p.y - middle.y) * 0.4
  )
}

/** Places each loop's marker in the clearest spot inside its loop or just beside it. */
export function placeMarkers({
  views,
  edges,
  obstacles,
  ctx,
}: {
  views: LoopView[]
  edges: Edge[]
  obstacles: Obstacles
  ctx: Context
}): Marker[] {
  const shapes = views.map((view) => ({ view, outline: loopOutline({ view, edges }) }))
  return shapes.map((shape) => {
    const { view } = shape
    const badge = badgeFor({ view, ctx })
    badge.clockwise = signedArea(shape.outline) >= 0
    const size = badgeSize({ badge, kit: ctx.text, size: 12.5 })
    const boxOf = (p: Point) => ({ x: p.x - size.w / 2, y: p.y - size.above, w: size.w, h: size.h })
    const frame = inflate({ box: bounds({ boxes: [], points: shape.outline }), pad: REACH })
    const middle = centroid(shape.outline)
    let best = middle
    let bestCost = Infinity
    for (let y = frame.y; y <= frame.y + frame.h; y += 9) {
      const own = rowCrossings({ polygon: shape.outline, y })
      const rest = shapes
        .filter((s) => s !== shape)
        .map((s) => rowCrossings({ polygon: s.outline, y }))
      for (let x = frame.x; x <= frame.x + frame.w; x += 9) {
        const p = { x, y }
        const within = insideRow({ xs: own, x })
        const shared = rest.filter((xs) => insideRow({ xs, x })).length
        const cost = spotCost({ p, box: boxOf(p), shape, within, shared, middle, obstacles })
        if (cost < bestCost) {
          bestCost = cost
          best = p
        }
      }
    }
    const box = boxOf(best)
    obstacles.boxes.push(box)
    return { view, badge, at: best, box }
  })
}

/** The label box that sits beside a dot in direction `angle`, `gap` clear of it. */
function besideDot({ node, angle, gap }: { node: LayoutNode; angle: number; gap: number }): Box {
  const ux = Math.cos(angle)
  const uy = Math.sin(angle)
  const { w, h } = node.label
  const reach = Math.min(w / 2 / Math.abs(ux || 1e-9), h / 2 / Math.abs(uy || 1e-9))
  const d = node.r + gap + reach
  return boxAt({ center: { x: node.x + ux * d, y: node.y + uy * d }, w, h })
}

/**
 * How much nearer a label sits to some other dot than to its own, with a margin: a label that far
 * off reads as the other variable's.
 */
function astray({ box, node, nodes }: { box: Box; node: LayoutNode; nodes: LayoutNode[] }): number {
  const from = (n: LayoutNode) => {
    const x = Math.max(box.x, Math.min(n.x, box.x + box.w))
    const y = Math.max(box.y, Math.min(n.y, box.y + box.h))
    return Math.hypot(x - n.x, y - n.y) - n.r
  }
  const own = from(node)
  const other = Math.min(...nodes.filter((n) => n !== node).map(from))
  return Math.max(0, own - other + 24)
}

/**
 * What a label of `node` pays for sitting inside loops: a lot inside a loop it isn't on (that
 * space is the loop's), less inside its own loops (a dot hemmed in by them can only be labelled
 * there, and far outside reads as nobody's), nothing for a loop its dot already sits inside.
 */
function insideCost({ node, views, outlines }: { node: LayoutNode; views: LoopView[]; outlines: Point[][] }) {
  const costs = views.map((view, i) => {
    if (view.loop.cycle.nodes.includes(node.id)) return 200
    return inside({ p: node, polygon: outlines[i] }) ? 0 : 600
  })
  return (box: Box) => {
    const c = { x: box.x + box.w / 2, y: box.y + box.h / 2 }
    return outlines.reduce((sum, polygon, i) => sum + (inside({ p: c, polygon }) ? costs[i] : 0), 0)
  }
}

/**
 * Puts each variable's label beside its dot: away from the middle of the loops it's on and
 * outside every loop, where no link, dot or other label is, preferring the sides over above and
 * below. The insides of loops are left for their markers.
 */
export function placeLabels({
  nodes,
  views,
  edges,
  obstacles,
}: {
  nodes: LayoutNode[]
  views: LoopView[]
  edges: Edge[]
  obstacles: Obstacles
}): Box[] {
  const middle = centroid(nodes)
  const outlines = views.map((view) => loopOutline({ view, edges }))
  return nodes.map((node) => {
    const centers = views.filter((v) => v.ring.members.includes(node.id)).map((v) => v.center)
    const from = centers.length ? centroid(centers) : middle
    const away = Math.atan2(node.y - from.y, node.x - from.x)
    const within = insideCost({ node, views, outlines })
    let best = besideDot({ node, angle: away, gap: 6 })
    let bestCost = Infinity
    for (const gap of GAPS)
      for (let i = 0; i < 24; i++) {
        const angle = (i / 24) * Math.PI * 2
        const box = besideDot({ node, angle, gap })
        const turn = Math.abs(wrapAngle(angle - away))
        const cost =
          crowding({ box: inflate({ box, pad: 3 }), obstacles }) * 2 +
          turn * turn * 40 +
          within(box) +
          astray({ box, node, nodes }) * 40 +
          Math.abs(Math.sin(angle)) * 25 +
          gap * 6 +
          gap * gap * 0.4
        if (cost < bestCost) {
          bestCost = cost
          best = box
        }
      }
    obstacles.boxes.push(best)
    return best
  })
}

/** How far back from the arrowhead a sign may sit: beside it first, further up the link if a label is there. */
const SIGN_BACK = [16, 28, 40]

/** Puts each link's sign beside its arrowhead, on whichever side is clearer. */
export function placeSigns({ edges, obstacles }: { edges: Edge[]; obstacles: Obstacles }): Point[] {
  return edges.map((edge) => {
    const { curve } = edge
    const options = SIGN_BACK.flatMap((distance) => {
      const back = Math.max(edge.t0, edge.t1 - curveStep({ curve, distance }))
      const p = curvePoint({ curve, t: back })
      const heading = curveHeading({ curve, t: back })
      const radial = { x: -Math.sin(heading), y: Math.cos(heading) }
      return [13, -13, 17, -17].map((k, i) => ({
        at: { x: p.x + radial.x * k, y: p.y + radial.y * k },
        bias: i * 2 + (distance - SIGN_BACK[0]) * 3,
      }))
    })
    const costs = options.map(
      ({ at, bias }) => crowding({ box: boxAt({ center: at, w: 25, h: 25 }), obstacles }) + bias,
    )
    const { at } = options[costs.indexOf(Math.min(...costs))]
    obstacles.boxes.push(boxAt({ center: at, w: 17, h: 17 }))
    return at
  })
}
