import type { Point } from '../../core/geometry.ts'
import type { LayoutNode, Ring } from './cld-layout.ts'
import { routes } from './cld-routes.ts'
import { insideRow, rowCrossings } from './cld-spots.ts'
import { curveLength, curvePoint } from './link-arc.ts'
import type { Link } from './model.ts'
import { type Box, bounds, centroid, contains, inflate } from './vec.ts'

/**
 * The last step of the causal loop layout: a local search that moves variables to cut link
 * crossings. A move shifts a free variable, slides one round its primary circle, or swaps two of
 * a kind, and stays only when it lowers the score: crossings first, then links grazing variables
 * they don't connect, crowded labels, variables in the middle of a loop, and total link length.
 */

const CROSSING = 400
/** Clearance a loop's marker needs from links and dots, and the grid its spot is sought on. */
const ROOM = 55
/** Cost per point of link running through a variable's clearest label spot. */
const LABEL = 40
const GRID = 24
/** Cost of a link running twice its chord's length: winding links read as badly as crossings. */
const BEND = 70
/** Cost per unit of link length, which keeps the diagram compact. */
const LENGTH = 0.04
/** Cost per unit a link runs beyond its chord, on top of BEND, so long links can't wander freely. */
const WIND = 0.3
/** Links shorter than this crowd their arrowheads and signs. */
const SHORT = 170
/**
 * Links longer than this sprawl, and cost per unit beyond it, so a variable can't wander off to
 * the edge of the diagram to dodge a crossing or two.
 */
const LONG = 340
const SPRAWL = 5
const GRAZE = 18
const CLEAR = 70
const STEPS = [24, 60, 120]
const SLIDES = [0.12, -0.12, 0.26, -0.26]

interface Search {
  nodes: Map<string, LayoutNode>
  links: Link[]
  rings: Ring[]
  /** The primary circle each pinned variable sits on. */
  circleOf: Map<string, Ring>
}

interface Drawn {
  index: number
  link: Link
  points: Point[]
  /** The bounds of `points`, to skip pairs of links that can't cross. */
  frame: Box
  length: number
  chord: number
}

/** A loop's outline with its bounds. */
interface Outline {
  points: Point[]
  frame: Box
}

function outlineOf(points: Point[]): Outline {
  return { points, frame: bounds({ boxes: [], points }) }
}

function apart({ a, b }: { a: Box; b: Box }): boolean {
  return a.x > b.x + b.w || b.x > a.x + a.w || a.y > b.y + b.h || b.y > a.y + a.h
}

type Segment = [Point, Point]

function sideOf({ line, p }: { line: Segment; p: Point }): number {
  const [a, b] = line
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
}

function crossings({ a, b }: { a: Point[]; b: Point[] }): number {
  let count = 0
  for (let i = 1; i < a.length; i++)
    for (let j = 1; j < b.length; j++) {
      const one: Segment = [a[i - 1], a[i]]
      const two: Segment = [b[j - 1], b[j]]
      if (
        sideOf({ line: one, p: two[0] }) * sideOf({ line: one, p: two[1] }) < 0 &&
        sideOf({ line: two, p: one[0] }) * sideOf({ line: two, p: one[1] }) < 0
      )
        count++
    }
  return count
}

function drawn(search: Search): Drawn[] {
  return routes(search).flatMap((route) => {
    if (!route) return []
    const points = Array.from({ length: 13 }, (_, i) =>
      curvePoint({ curve: route.curve, t: 0.06 + (0.88 * i) / 12 }),
    )
    const { p0, p1 } = route.curve
    const chord = Math.hypot(p1.x - p0.x, p1.y - p0.y)
    const link = search.links[route.index]
    const frame = bounds({ boxes: [], points })
    return [{ index: route.index, link, points, frame, length: curveLength(route.curve), chord }]
  })
}

/** How far `p` is from the nearest of `marks`, or `floor` as soon as one is no further than that. */
function nearest({ p, marks, floor }: { p: Point; marks: Point[]; floor: number }): number {
  let best = Infinity
  let closest = p
  for (const m of marks) {
    const d = (m.x - p.x) ** 2 + (m.y - p.y) ** 2
    if (d >= best) continue
    best = d
    closest = m
    if (best <= floor * floor) return floor
  }
  return Math.hypot(closest.x - p.x, closest.y - p.y)
}

/** The most clearance any spot inside `outline` and outside the `others` has from `marks`, up to ROOM. */
function clearance({
  outline,
  others,
  marks,
}: {
  outline: Outline
  others: Outline[]
  marks: Point[]
}): number {
  const { frame } = outline
  let best = 0
  for (let y = frame.y + GRID / 2; y < frame.y + frame.h; y += GRID) {
    const own = rowCrossings({ polygon: outline.points, y })
    if (!own.length) continue
    const rest = others
      .filter((o) => y >= o.frame.y && y <= o.frame.y + o.frame.h)
      .map((o) => rowCrossings({ polygon: o.points, y }))
    for (let x = frame.x + GRID / 2; x < frame.x + frame.w; x += GRID) {
      if (!insideRow({ xs: own, x }) || rest.some((xs) => insideRow({ xs, x }))) continue
      best = Math.max(best, nearest({ p: { x, y }, marks, floor: best }))
      if (best >= ROOM) return ROOM
    }
  }
  return best
}

/** How short each loop falls of a clear spot for its marker, inside it and outside the others. */
function cramped({ lines, search }: { lines: Drawn[]; search: Search }): number {
  const outlines = search.rings.map((ring) =>
    outlineOf(
      lines.filter((l) => ring.loop.cycle.links.includes(l.index)).flatMap((l) => l.points),
    ),
  )
  const marks = [...lines.flatMap((l) => l.points), ...search.nodes.values()]
  return outlines.reduce((cost, outline, i) => {
    if (outline.points.length < 3) return cost
    const others = outlines.filter((_, j) => j !== i)
    return cost + (ROOM - clearance({ outline, others, marks })) * 8
  }, 0)
}

/** How much links run past variables they don't connect. */
function grazing({ lines, nodes }: { lines: Drawn[]; nodes: LayoutNode[] }): number {
  let cost = 0
  for (const line of lines)
    for (const node of nodes) {
      if (node.id === line.link.from || node.id === line.link.to) continue
      for (const p of line.points) {
        const gap = Math.hypot(p.x - node.x, p.y - node.y) - node.r - GRAZE
        if (gap < 0) cost -= gap * 10
      }
    }
  return cost
}

/** The four places a variable's label can go: right of its dot, left, above and below. */
function labelSpots(node: LayoutNode): Box[] {
  const { w, h } = node.label
  const gap = node.r + 6
  return [
    { x: node.x + gap, y: node.y - h / 2, w, h },
    { x: node.x - gap - w, y: node.y - h / 2, w, h },
    { x: node.x - w / 2, y: node.y - gap - h, w, h },
    { x: node.x - w / 2, y: node.y + gap, w, h },
  ]
}

/** How many links run through even the clearest of each variable's label spots. */
function unlabelled({ lines, nodes }: { lines: Drawn[]; nodes: LayoutNode[] }): number {
  const points = lines.flatMap((line) =>
    line.points.flatMap((p, i) => {
      const q = line.points[i + 1]
      return q ? [p, { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }] : [p]
    }),
  )
  let cost = 0
  for (const node of nodes) {
    let fewest = Infinity
    for (const spot of labelSpots(node)) {
      const box = inflate({ box: spot, pad: 3 })
      let hits = 0
      for (const p of points) if (contains({ box, p })) hits++
      fewest = Math.min(fewest, hits)
    }
    cost += fewest * LABEL
  }
  return cost
}

/** How much variables' label room overlaps. */
function crowding(nodes: LayoutNode[]): number {
  let cost = 0
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]
      const b = nodes[j]
      const ox = (a.w + b.w) / 2 + 12 - Math.abs(a.x - b.x)
      const oy = (a.h + b.h) / 2 + 12 - Math.abs(a.y - b.y)
      if (ox > 0 && oy > 0) cost += Math.min(ox, oy) * 8
    }
  return cost
}

/** How far variables intrude on the middle of loops they aren't on, where the markers go. */
function intruding({ rings, nodes }: { rings: Ring[]; nodes: Map<string, LayoutNode> }): number {
  let cost = 0
  for (const ring of rings) {
    const members = new Set(ring.members)
    const c = centroid(ring.members.flatMap((id) => nodes.get(id) ?? []))
    for (const node of nodes.values()) {
      if (members.has(node.id)) continue
      const d = Math.hypot(node.x - c.x, node.y - c.y)
      if (d < CLEAR) cost += (CLEAR - d) * 4
    }
  }
  return cost
}

export function score(search: Search): number {
  const lines = drawn(search)
  const nodes = [...search.nodes.values()]
  let cost = 0
  for (let i = 0; i < lines.length; i++)
    for (let j = i + 1; j < lines.length; j++)
      if (!apart({ a: lines[i].frame, b: lines[j].frame }))
        cost += crossings({ a: lines[i].points, b: lines[j].points }) * CROSSING
  cost += grazing({ lines, nodes })
  cost += crowding(nodes)
  cost += intruding({ rings: search.rings, nodes: search.nodes })
  cost += cramped({ lines, search })
  cost += unlabelled({ lines, nodes })
  for (const line of lines) {
    const chord = Math.max(line.chord, 1)
    cost += line.length * LENGTH + (line.length - chord) * WIND
    cost += ((line.length - chord) / chord) * BEND
    cost += Math.max(0, SHORT - chord) * 3
    cost += Math.max(0, chord - LONG) * SPRAWL
  }
  return cost
}

interface State {
  search: Search
  cost: number
}

/** Moves some variables; keeps the move if it scores better, else puts them back. */
function attempt({ state, moves }: { state: State; moves: [LayoutNode, Point][] }): boolean {
  const saved = moves.map(([node]) => ({ node, x: node.x, y: node.y }))
  for (const [node, p] of moves) {
    node.x = p.x
    node.y = p.y
  }
  const cost = score(state.search)
  if (cost < state.cost - 0.5) {
    state.cost = cost
    return true
  }
  for (const { node, x, y } of saved) {
    node.x = x
    node.y = y
  }
  return false
}

function shifts({ state, node }: { state: State; node: LayoutNode }): boolean {
  let better = false
  for (const step of STEPS)
    for (let k = 0; k < 8; k++) {
      const angle = (k / 8) * Math.PI * 2
      const p = { x: node.x + Math.cos(angle) * step, y: node.y + Math.sin(angle) * step }
      better = attempt({ state, moves: [[node, p]] }) || better
    }
  return better
}

function slides({ state, node, ring }: { state: State; node: LayoutNode; ring: Ring }): boolean {
  const circle = ring.circle
  if (!circle) return false
  let better = false
  for (const turn of SLIDES) {
    const angle = Math.atan2(node.y - circle.center.y, node.x - circle.center.x) + turn
    const p = {
      x: circle.center.x + Math.cos(angle) * circle.r,
      y: circle.center.y + Math.sin(angle) * circle.r,
    }
    better = attempt({ state, moves: [[node, p]] }) || better
  }
  return better
}

/** Swaps pairs of free variables, and pairs on the same primary circle. */
function swaps(state: State): boolean {
  const { nodes, circleOf } = state.search
  const list = [...nodes.values()]
  let better = false
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]
      const b = list[j]
      const ring = circleOf.get(a.id)
      if (ring !== circleOf.get(b.id) || ring?.arcs) continue
      const moves: [LayoutNode, Point][] = [
        [a, { x: b.x, y: b.y }],
        [b, { x: a.x, y: a.y }],
      ]
      better = attempt({ state, moves }) || better
    }
  return better
}

/** The circle each variable sits on, and the variables on more than one. */
function circlesOf(rings: Ring[]): { circleOf: Map<string, Ring>; fixed: Set<string> } {
  const circleOf = new Map<string, Ring>()
  const fixed = new Set<string>()
  for (const ring of rings.filter((r) => r.circle))
    for (const id of ring.members) {
      if (circleOf.has(id) || ring.arcs) fixed.add(id)
      circleOf.set(id, ring)
    }
  return { circleOf, fixed }
}

/**
 * Moves variables until no single move cuts crossings or crowding any further. Variables on a
 * primary circle stay on it, and one on two circles at once, such as a hub, stays put: sliding
 * round one would break the other. Rings come in the priority order their headings follow.
 */
export function untangle({
  nodes,
  links,
  rings,
}: {
  nodes: Map<string, LayoutNode>
  links: Link[]
  rings: Ring[]
}): number {
  const { circleOf, fixed } = circlesOf(rings)
  const search: Search = { nodes, links, rings, circleOf }
  const state: State = { search, cost: score(search) }
  for (let pass = 0; pass < 6; pass++) {
    let better = swaps(state)
    for (const node of [...nodes.values()].filter((n) => !fixed.has(n.id))) {
      const ring = circleOf.get(node.id)
      better = (ring ? slides({ state, node, ring }) : shifts({ state, node })) || better
    }
    if (!better) break
  }
  return state.cost
}
