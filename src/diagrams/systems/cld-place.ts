import type { Point } from '../../core/geometry.ts'
import type { Rng } from '../../core/rng.ts'
import type { LayoutNode, Ring } from './cld-layout.ts'
import type { Link, NamedLoop } from './model.ts'
import { centroid, len, sub, unit, wrapAngle } from './vec.ts'

/**
 * The first, constructive half of the causal loop layout. Loops are placed one at a time; each
 * run of a loop's new variables (between two already placed) goes on the arc through its two
 * ends that crowds what's placed least, so loops that share a spine nest instead of colliding.
 */

export interface Placement {
  nodes: Map<string, LayoutNode>
  placed: Set<string>
  links: Link[]
  rng: Rng
  /** Loops placed so far, whose insides new variables keep out of. */
  rings: Ring[]
}

const GAP = 48
const CROWD = 165

/** Orders loops so each one after the first shares a variable with those before, when it can. */
export function placementOrder(loops: NamedLoop[]): NamedLoop[] {
  const rest = [...loops]
  const out: NamedLoop[] = []
  const seen = new Set<string>()
  while (rest.length) {
    const linked = rest.findIndex((loop) => loop.cycle.nodes.some((id) => seen.has(id)))
    const [next] = rest.splice(Math.max(0, linked), 1)
    out.push(next)
    for (const id of next.cycle.nodes) seen.add(id)
  }
  return out
}

function randomDirection(rng: Rng): Point {
  const angle = rng.next() * Math.PI * 2
  return { x: Math.cos(angle), y: Math.sin(angle) }
}

interface Run {
  ids: string[]
  before: string
  after: string
}

/** Stretches of unplaced variables in travel order, each between two placed ones. */
function runsOf({ cycle, placed }: { cycle: string[]; placed: Set<string> }): Run[] {
  const start = cycle.findIndex((id) => placed.has(id))
  const rotated = [...cycle.slice(start), ...cycle.slice(0, start)]
  const runs: Run[] = []
  let current: string[] = []
  let before = rotated[0]
  for (const id of [...rotated.slice(1), rotated[0]]) {
    if (!placed.has(id)) {
      current.push(id)
      continue
    }
    if (current.length) runs.push({ ids: current, before, after: id })
    current = []
    before = id
  }
  return runs
}

function moveTo({ placement, id, p }: { placement: Placement; id: string; p: Point }): void {
  const node = placement.nodes.get(id)
  if (!node) return
  node.x = p.x
  node.y = p.y
  placement.placed.add(id)
}

/** A loop that shares nothing with what's placed goes on its own ring to the right. */
function placeApart({ ring, placement }: { ring: Ring; placement: Placement }): void {
  const placedNodes = [...placement.placed].flatMap((id) => placement.nodes.get(id) ?? [])
  const right = placedNodes.length
    ? Math.max(...placedNodes.map((n) => n.x + n.w / 2))
    : -ring.r - 80
  const center = { x: right + ring.r + 80, y: 0 }
  const cycle = ring.members
  const offset = cycle.length === 2 ? Math.PI : -Math.PI / 2
  cycle.forEach((id, i) => {
    const angle = offset + (i / cycle.length) * Math.PI * 2
    const p = { x: center.x + Math.cos(angle) * ring.r, y: center.y + Math.sin(angle) * ring.r }
    moveTo({ placement, id, p })
  })
}

/** `count` points evenly spaced strictly between two angles on a circle. */
function along({
  center,
  r,
  from,
  sweep,
  count,
}: {
  center: Point
  r: number
  from: number
  sweep: number
  count: number
}): Point[] {
  return Array.from({ length: count }, (_, j) => {
    const angle = from + sweep * ((j + 1) / (count + 1))
    return { x: center.x + Math.cos(angle) * r, y: center.y + Math.sin(angle) * r }
  })
}

/** A way to place a run: where its variables go, and the curve its links will roughly follow. */
interface Option {
  points: Point[]
  path: Point[]
  length: number
}

/** An option on the circle arc from angle `from` turning by `sweep`. */
function onArc({
  center,
  r,
  from,
  sweep,
  count,
}: {
  center: Point
  r: number
  from: number
  sweep: number
  count: number
}): Option {
  const length = Math.abs(sweep) * r
  const steps = Math.max(2, Math.ceil(length / 20))
  const path = Array.from({ length: steps + 1 }, (_, i) => {
    const angle = from + (sweep * i) / steps
    return { x: center.x + Math.cos(angle) * r, y: center.y + Math.sin(angle) * r }
  })
  return { points: along({ center, r, from, sweep, count }), path, length }
}

/** Rings through a single shared variable, in sixteen directions and both turning senses. */
function loopsThrough({ a, r, count }: { a: Point; r: number; count: number }): Option[] {
  return Array.from({ length: 32 }, (_, i) => {
    const angle = ((i >> 1) / 16) * Math.PI * 2
    const center = { x: a.x + Math.cos(angle) * r, y: a.y + Math.sin(angle) * r }
    const sweep = (i % 2 ? 1 : -1) * Math.PI * 2
    return onArc({ center, r, from: angle + Math.PI, sweep, count })
  })
}

/** Arcs from `a` to `b` bowing either way by a range of depths, with room for `count` stops. */
function arcsBetween({
  a,
  b,
  count,
  spacing,
}: {
  a: Point
  b: Point
  count: number
  spacing: number
}): Option[] {
  const c = Math.hypot(b.x - a.x, b.y - a.y)
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  const perp = unit({ x: -(b.y - a.y), y: b.x - a.x })
  const depths = [0.2, 0.32, 0.45, 0.6, 0.8, 1.05, 1.35, 1.7, 2.2].map((f) => f * c)
  const fixed = [50, 90, 140, 200, 270, 350, 440]
  const out: Option[] = []
  for (const side of [1, -1])
    for (const s of [...depths, ...fixed]) {
      const r = (c * c) / 4 / (2 * s) + s / 2
      const center = { x: mid.x + perp.x * side * (s - r), y: mid.y + perp.y * side * (s - r) }
      const from = Math.atan2(a.y - center.y, a.x - center.x)
      const bulge = Math.atan2(perp.y * side, perp.x * side)
      const dir = wrapAngle(bulge - from) >= 0 ? 1 : -1
      let sweep = dir * (Math.atan2(b.y - center.y, b.x - center.x) - from)
      while (sweep <= 0) sweep += Math.PI * 2
      if (r * sweep >= (count + 1) * spacing * 0.85)
        out.push(onArc({ center, r, from, sweep: dir * sweep, count }))
    }
  return out
}

interface Obstacles {
  /** Placed variables and points along placed links: new variables keep away from these. */
  points: Point[]
  /** Placed variables: new links keep from running through these. */
  nodes: LayoutNode[]
  discs: Disc[]
  /** Links between placed variables, as straight segments. */
  segments: [Point, Point][]
}

function sideOf({ line, p }: { line: [Point, Point]; p: Point }): number {
  const [a, b] = line
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
}

/** How many times a path crosses the segments (touching at an end doesn't count). */
function crossed({ path, segments }: { path: Point[]; segments: [Point, Point][] }): number {
  let count = 0
  for (const seg of segments)
    for (let i = 1; i < path.length; i++) {
      const step: [Point, Point] = [path[i - 1], path[i]]
      const apart =
        sideOf({ line: seg, p: step[0] }) * sideOf({ line: seg, p: step[1] }) < 0 &&
        sideOf({ line: step, p: seg[0] }) * sideOf({ line: step, p: seg[1] }) < 0
      if (apart) count++
    }
  return count
}

/** How close a point comes to the inside of a variable's label, as a positive intrusion. */
function intrusion({ p, node }: { p: Point; node: LayoutNode }): number {
  const dx = Math.abs(p.x - node.x) - node.w / 2
  const dy = Math.abs(p.y - node.y) - node.h / 2
  const gap = Math.hypot(Math.max(dx, 0), Math.max(dy, 0))
  return Math.max(0, 34 - gap)
}

/**
 * What an option costs: crowding near placed variables and links, links that would run through
 * placed variables, then its length.
 */
function crowding({
  option,
  ends,
  obstacles,
}: {
  option: Option
  ends: [Point, Point]
  obstacles: Obstacles
}): number {
  let cost = option.length + crossed({ path: option.path, segments: obstacles.segments }) * 2500
  for (const p of option.points) cost += Math.abs(p.y - ends[0].y) * 0.25
  for (const p of option.points)
    for (const q of obstacles.points) {
      const d = Math.hypot(p.x - q.x, p.y - q.y)
      if (d < CROWD) cost += (CROWD - d) ** 2
    }
  const others = obstacles.nodes.filter((node) => node !== ends[0] && node !== ends[1])
  for (const p of option.path) for (const node of others) cost += intrusion({ p, node }) ** 2 * 12
  return cost + trespass({ option, discs: obstacles.discs })
}

/** What it costs to put variables, and to a lesser degree links, inside loops already drawn. */
function trespass({ option, discs }: { option: Option; discs: Disc[] }): number {
  let cost = 0
  const depth = (p: Point, disc: Disc) => 1 - Math.hypot(p.x - disc.c.x, p.y - disc.c.y) / disc.r
  for (const disc of discs) {
    for (const p of option.points) cost += Math.max(0, depth(p, disc) + 0.1) * 6000
    for (const p of option.path) cost += Math.max(0, depth(p, disc) - 0.04) * 900
  }
  return cost
}

interface Disc {
  c: Point
  r: number
}

/** Each placed loop as the disc it roughly fills. */
function discsOf(placement: Placement): Disc[] {
  return placement.rings.map((ring) => {
    const points = ring.members.flatMap((id) => placement.nodes.get(id) ?? [])
    const c = centroid(points)
    const r = points.reduce((sum, p) => sum + Math.hypot(p.x - c.x, p.y - c.y), 0) / points.length
    return { c, r: Math.max(r, 1) }
  })
}

function obstaclesOf(placement: Placement): Obstacles {
  const at = (id: string) => placement.nodes.get(id)
  const nodes = [...placement.placed].flatMap((id) => at(id) ?? [])
  const along = placement.links.flatMap((l) => {
    const a = placement.placed.has(l.from) ? at(l.from) : undefined
    const b = placement.placed.has(l.to) ? at(l.to) : undefined
    return a && b
      ? [0.25, 0.5, 0.75].map((t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }))
      : []
  })
  const segments = placement.links.flatMap((l): [Point, Point][] => {
    const a = placement.placed.has(l.from) ? at(l.from) : undefined
    const b = placement.placed.has(l.to) ? at(l.to) : undefined
    return a && b && a !== b ? [[a, b]] : []
  })
  return { points: [...nodes, ...along], nodes, discs: discsOf(placement), segments }
}

/** Which way each placed loop through `id` leans from it, as an angle. */
function petalsAt({ id, placement }: { id: string; placement: Placement }): number[] {
  const a = placement.nodes.get(id)
  if (!a) return []
  return placement.rings
    .filter((ring) => ring.members.includes(id))
    .map((ring) => {
      const c = centroid(ring.members.flatMap((m) => placement.nodes.get(m) ?? []))
      return Math.atan2(c.y - a.y, c.x - a.x)
    })
}

/**
 * What it costs a loop through one placed variable `a` to lean toward the loops already there:
 * nothing once it's as far from each as an even share of the turn, so loops through one hub fan
 * out round it like petals.
 */
function crowded({ option, a, petals }: { option: Option; a: Point; petals: number[] }): number {
  if (!petals.length) return 0
  const spread = ((Math.PI * 2) / (petals.length + 1)) * 0.9
  const c = centroid(option.points)
  const angle = Math.atan2(c.y - a.y, c.x - a.x)
  let cost = 0
  for (const petal of petals) cost += Math.max(0, spread - Math.abs(wrapAngle(angle - petal))) * 20000
  return cost
}

/** Places one run of new variables on the least crowded arc between its placed ends. */
function placeRun({ run, ring, placement }: { run: Run; ring: Ring; placement: Placement }): void {
  const at = (id: string): Point => placement.nodes.get(id) ?? { x: 0, y: 0 }
  const a = at(run.before)
  const b = at(run.after)
  const spans = run.ids.map((id) => {
    const node = placement.nodes.get(id)
    return node ? (node.w + node.h) / 2 : 80
  })
  const spacing = Math.max(...spans) + GAP
  const options =
    Math.hypot(a.x - b.x, a.y - b.y) < 1
      ? loopsThrough({ a, r: ring.r, count: run.ids.length })
      : arcsBetween({ a, b, count: run.ids.length, spacing })
  const obstacles = obstaclesOf(placement)
  const petals = Math.hypot(a.x - b.x, a.y - b.y) < 1 ? petalsAt({ id: run.before, placement }) : []
  let best = options[0]?.points ?? []
  let bestCost = Infinity
  for (const option of options) {
    const cost = crowding({ option, ends: [a, b], obstacles }) + crowded({ option, a, petals })
    if (cost < bestCost) {
      bestCost = cost
      best = option.points
    }
  }
  run.ids.forEach((id, j) => {
    moveTo({ placement, id, p: best[j] ?? a })
  })
}

/** Puts one loop's unplaced variables in place, run by run. Returns how many it placed. */
export function placeLoop({ ring, placement }: { ring: Ring; placement: Placement }): number {
  const cycle = ring.members
  const fresh = cycle.filter((id) => !placement.placed.has(id)).length
  if (fresh === cycle.length) placeApart({ ring, placement })
  else
    for (const run of runsOf({ cycle, placed: placement.placed }))
      placeRun({ run, ring, placement })
  placement.rings.push(ring)
  return fresh
}

function neighbours({ id, links }: { id: string; links: Link[] }): string[] {
  return links.flatMap((l) => {
    if (l.from === id) return [l.to]
    return l.to === id ? [l.from] : []
  })
}

/** Places one straggler beside its placed neighbours, outward from the middle. */
function placeBeside({
  node,
  near,
  placement,
}: {
  node: LayoutNode
  near: string[]
  placement: Placement
}): void {
  const at = (id: string): Point => placement.nodes.get(id) ?? { x: 0, y: 0 }
  const mass = centroid([...placement.placed].map(at))
  const base = near.length ? centroid(near.map(at)) : mass
  const away = sub({ a: base, b: mass })
  const outward = len(away) > 1 ? unit(away) : randomDirection(placement.rng)
  const reach = (near.length ? 120 : 240) + node.w / 2
  const p = {
    x: base.x + outward.x * reach + placement.rng.normal() * 6,
    y: base.y + outward.y * reach + placement.rng.normal() * 6,
  }
  moveTo({ placement, id: node.id, p })
}

/** Puts variables outside every labelled loop next to the variables they link with. */
export function placeStragglers(placement: Placement): void {
  const { nodes, placed, links } = placement
  for (let pass = 0; pass <= nodes.size && placed.size < nodes.size; pass++) {
    const last = pass === nodes.size || !placed.size
    for (const node of nodes.values()) {
      const near = neighbours({ id: node.id, links }).filter((id) => placed.has(id))
      const ready = !placed.has(node.id) && (near.length || last)
      if (ready) placeBeside({ node, near, placement })
    }
  }
}
