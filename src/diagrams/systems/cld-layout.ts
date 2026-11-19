import {
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationNodeDatum,
} from 'd3-force'
import type { Point } from '../../core/geometry.ts'
import { span } from '../../core/profile.ts'
import type { Rng } from '../../core/rng.ts'
import { type Placement, placeLoop, placementOrder, placeStragglers } from './cld-place.ts'
import { byPriority, kissOf, peripheralRuns } from './cld-routes.ts'
import { untangle } from './cld-untangle.ts'
import type { Link, NamedLoop } from './model.ts'
import { type Box, boxAt, centroid, wrapAngle } from './vec.ts'

/**
 * Causal loop layout. Loops are the structure, so they lead: each labelled loop's variables go
 * on a ring, loops that share variables are packed so the shared ones sit where they meet (see
 * cld-place.ts), and d3-force then evens things out with a ring force, box collision and a rule
 * that keeps each ring's middle clear for its marker. Last, the primary loop of each group of
 * loops that share variables is snapped onto an exact circle.
 */

/** A variable: a dot at (x, y), with room of w × h kept around it for its label. */
export interface LayoutNode extends SimulationNodeDatum {
  id: string
  w: number
  h: number
  x: number
  y: number
  /** The dot's radius. */
  r: number
  /** The label's size; where it goes is decided once the links are drawn. */
  label: { w: number; h: number }
}

export interface Circle {
  center: Point
  r: number
}

export interface Ring {
  loop: NamedLoop
  members: string[]
  r: number
  /** How hard the ring force holds this loop round: loops that brought most of their own variables hold firmest. */
  hold: number
  /** The exact circle a primary loop's variables sit on; null for the loops that share with it. */
  circle: Circle | null
  /** Links the layout has shaped already, as arcs of set circles: a nest's (see `nest`). */
  arcs?: Arc[]
}

/** A link drawn round `center`, clockwise on screen when `sign` is +1. */
export interface Arc {
  link: number
  center: Point
  sign: number
}

const GAP = 46
/** How many crossing searches run, each from the settled layout shaken differently; the best wins. */
const STARTS = 3
const SHAKE = 90
const MIN_R = 92
const CLEAR = 60

function ringRadius({
  members,
  nodes,
}: {
  members: string[]
  nodes: Map<string, LayoutNode>
}): number {
  const spans = members.map((id) => {
    const node = nodes.get(id)
    return node ? (node.w + node.h) / 2 : 60
  })
  const widest = Math.max(...members.map((id) => (nodes.get(id)?.w ?? 60) / 2))
  const around = (spans.reduce((a, b) => a + b, 0) + members.length * GAP) / (Math.PI * 2)
  return Math.max(MIN_R, around, CLEAR + widest * 0.8)
}

function membersOf({ ring, nodes }: { ring: Ring; nodes: Map<string, LayoutNode> }): LayoutNode[] {
  return ring.members.flatMap((id) => nodes.get(id) ?? [])
}

function meanRadius(points: Point[]): number {
  const c = centroid(points)
  return points.reduce((sum, p) => sum + Math.hypot(p.x - c.x, p.y - c.y), 0) / (points.length || 1)
}

function nudge({ node, from, k }: { node: LayoutNode; from: Point; k: number }): void {
  node.vx = (node.vx ?? 0) + (node.x - from.x) * k
  node.vy = (node.vy ?? 0) + (node.y - from.y) * k
}

/** Pulls each ring's members toward its radius around their current centroid. */
function ringForce({ rings, nodes }: { rings: Ring[]; nodes: Map<string, LayoutNode> }) {
  return (alpha: number) => {
    for (const ring of rings.filter((r) => r.hold > 0)) {
      const members = membersOf({ ring, nodes })
      const c = centroid(members)
      for (const node of members) {
        const d = Math.hypot(node.x - c.x, node.y - c.y) || 1
        nudge({ node, from: c, k: ((ring.r - d) / d) * alpha * ring.hold })
      }
    }
  }
}

/** Pushes one non-member out of a ring's middle. */
function pushOut({ node, c, alpha }: { node: LayoutNode; c: Point; alpha: number }): void {
  const d = Math.hypot(node.x - c.x, node.y - c.y) || 1
  const need = CLEAR + Math.max(node.w, node.h) / 2
  if (d < need) nudge({ node, from: c, k: ((need - d) / d) * alpha * 0.8 })
}

/** Pushes variables that aren't on a ring out of its middle, where the loop marker goes. */
function clearForce({ rings, nodes }: { rings: Ring[]; nodes: Map<string, LayoutNode> }) {
  return (alpha: number) => {
    for (const ring of rings) {
      const members = new Set(ring.members)
      const c = centroid(membersOf({ ring, nodes }))
      for (const node of nodes.values()) if (!members.has(node.id)) pushOut({ node, c, alpha })
    }
  }
}

/** How much of a separation each of two boxes takes: all of it when the other is pinned. */
function shares({ a, b, pinned }: { a: LayoutNode; b: LayoutNode; pinned: Set<string> }) {
  const fixedA = pinned.has(a.id)
  const fixedB = pinned.has(b.id)
  if (fixedA === fixedB) return fixedA ? [0, 0] : [1, 1]
  return fixedA ? [0, 2] : [2, 0]
}

/** Separates two boxes along the axis where they overlap least; a pinned box stays put. */
function separate({
  a,
  b,
  pad,
  strength,
  pinned,
}: {
  a: LayoutNode
  b: LayoutNode
  pad: number
  strength: number
  pinned: Set<string>
}): void {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const ox = (a.w + b.w) / 2 + pad - Math.abs(dx)
  const oy = (a.h + b.h) / 2 + pad - Math.abs(dy)
  if (ox <= 0 || oy <= 0) return
  const [ka, kb] = shares({ a, b, pinned })
  const horizontal = ox * 1.6 < oy
  const shift = (horizontal ? ox : oy) * 0.5 * strength
  const sx = horizontal ? Math.sign(dx || 1) * shift : 0
  const sy = horizontal ? 0 : Math.sign(dy || 1) * shift
  a.x -= sx * ka
  a.y -= sy * ka
  b.x += sx * kb
  b.y += sy * kb
}

function collide({
  nodes,
  pad,
  strength,
  pinned = new Set(),
}: {
  nodes: LayoutNode[]
  pad: number
  strength: number
  pinned?: Set<string>
}): void {
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++)
      separate({ a: nodes[i], b: nodes[j], pad, strength, pinned })
}

/** Takes the loops in `rest` that share a variable with `group` out of it, growing the group. */
function absorb({ group, rest }: { group: Set<string>; rest: NamedLoop[] }): boolean {
  const index = rest.findIndex((loop) => loop.cycle.nodes.some((id) => group.has(id)))
  if (index < 0) return false
  const [loop] = rest.splice(index, 1)
  for (const id of loop.cycle.nodes) group.add(id)
  return true
}

/**
 * The primary loop of each group of loops that share variables: the first in `loops`, which
 * lists declared loops first, then the rest by importance. A two-variable loop only leads when
 * the group has nothing longer, since its circle would bulge into the loops around it.
 */
function primaries(loops: NamedLoop[]): Set<NamedLoop> {
  const out = new Set<NamedLoop>()
  const rest = [...loops]
  for (let first = rest.shift(); first; first = rest.shift()) {
    const group = new Set(first.cycle.nodes)
    const before = new Set(rest)
    while (absorb({ group, rest })) {}
    const members = [first, ...loops.filter((loop) => before.has(loop) && !rest.includes(loop))]
    out.add(members.find((loop) => loop.cycle.nodes.length > 2) ?? first)
  }
  return out
}

/**
 * Puts a ring's members on the circle through their mean distance from their centroid, each at
 * its own angle when they already go round in loop order, else evenly spaced from the first.
 */
function makeRound({ ring, nodes }: { ring: Ring; nodes: Map<string, LayoutNode> }): Circle {
  const members = membersOf({ ring, nodes })
  const count = members.length
  const center = centroid(members)
  const r = Math.max(meanRadius(members), MIN_R * 0.6)
  const angles = members.map((node) => Math.atan2(node.y - center.y, node.x - center.x))
  const turns = angles.map((a, i) => wrapAngle(angles[(i + 1) % count] - a))
  const sign = turns.reduce((sum, t) => sum + t, 0) >= 0 ? 1 : -1
  const even = (Math.PI * 2) / count
  const ordered = count < 3 || turns.every((t) => t * sign > even * 0.45)
  members.forEach((node, i) => {
    const angle = ordered ? angles[i] : angles[0] + sign * even * i
    node.x = center.x + Math.cos(angle) * r
    node.y = center.y + Math.sin(angle) * r
  })
  return { center, r }
}

interface SimLink {
  source: string
  target: string
  distance: number
  strength: number
}

/** Springs along every link, at the length the placement gave it, so the shape survives. */
function springs({ links, nodes }: { links: Link[]; nodes: Map<string, LayoutNode> }): SimLink[] {
  return links.flatMap((l) => {
    const a = nodes.get(l.from)
    const b = nodes.get(l.to)
    if (!a || !b || a === b) return []
    const d = Math.hypot(a.x - b.x, a.y - b.y)
    const clear = (a.w + b.w) / 2 + 80
    return [{ source: l.from, target: l.to, distance: Math.max(130, clear, d), strength: 0.18 }]
  })
}

/**
 * Lays out a causal loop diagram: rings first, then a seeded force refinement. Moves the nodes in
 * place and returns the rings with their final radii.
 */
export function layoutCld({
  nodes,
  links,
  loops,
  rng,
}: {
  nodes: LayoutNode[]
  links: Link[]
  loops: NamedLoop[]
  rng: Rng
}): Ring[] {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const leads = primaries(loops)
  const rings: Ring[] = placementOrder(loops).map((loop) => ({
    loop,
    members: loop.cycle.nodes,
    r: ringRadius({ members: loop.cycle.nodes, nodes: byId }),
    hold: 0,
    circle: null,
  }))
  const placement: Placement = { nodes: byId, placed: new Set(), links, rng, rings: [] }
  for (const ring of rings) {
    const fresh = placeLoop({ ring, placement })
    ring.hold = fresh * 2 > ring.members.length ? 0.5 : 0.12 * Math.sign(fresh)
    if (leads.has(ring.loop)) ring.hold = 0.8
    ring.r = meanRadius(membersOf({ ring, nodes: byId }))
  }
  placeStragglers(placement)
  simulate({ nodes, byId, links, rings, rng })
  const pinned = roundPrimaries({ rings, leads, links, nodes: byId })
  pinPetals({ rings: rings.filter((r) => !leads.has(r.loop)), all: rings, nodes: byId, pinned })
  for (let pass = 0; pass < 60; pass++) collide({ nodes, pad: 20, strength: 1, pinned })
  span('cld:untangle', () =>
    searchFrom({
      nodes,
      pinned,
      rng,
      run: () => untangle({ nodes: byId, links, rings: byPriority({ rings, loops }) }),
    }),
  )
  for (const ring of rings) if (ring.circle && ring.members.length === 2) ring.circle = across({ ring, nodes: byId })
  const mirrored = rings.flatMap((ring) => mirror({ ring, rings, nodes: byId }))
  const touched = touch({ nodes: byId, rings })
  const rounded = roundRest({
    rings: byPriority({ rings, loops }),
    nodes: byId,
    held: new Set([...pinned, ...mirrored]),
  })
  const held = new Set([...pinned, ...mirrored, ...touched, ...rounded])
  for (let pass = 0; pass < 30; pass++) collide({ nodes, pad: 20, strength: 1, pinned: held })
  lineUp({ nodes: byId, links, rings: byPriority({ rings, loops }) })
  return rings
}

/**
 * Puts each primary loop on its exact circle, then nests any loop that shares a path through one
 * middle variable with it. Returns the variables now pinned.
 */
function roundPrimaries({
  rings,
  leads,
  links,
  nodes,
}: {
  rings: Ring[]
  leads: Set<NamedLoop>
  links: Link[]
  nodes: Map<string, LayoutNode>
}): Set<string> {
  const pinned = new Set<string>()
  const primary = rings.filter((r) => leads.has(r.loop))
  for (const ring of primary) {
    ring.circle = makeRound({ ring, nodes })
    ring.r = ring.circle.r
    for (const id of ring.members) pinned.add(id)
  }
  for (const ring of primary) for (const id of nest({ ring, rings, links, nodes })) pinned.add(id)
  return pinned
}

/**
 * The one variable a loop of three or more shares with all the others, when that's all it shares:
 * the hub it hangs from like a petal. Null otherwise.
 */
function hubOf({ ring, rings }: { ring: Ring; rings: Ring[] }): string | null {
  if (ring.members.length < 3) return null
  const shared = ring.members.filter((id) =>
    rings.some((other) => other !== ring && other.members.includes(id)),
  )
  return shared.length === 1 ? shared[0] : null
}

/**
 * Rounds a petal onto the circle through its hub and around its middle, keeping the hub where it
 * is and each other variable at its angle, so the crossing search can't pull the petals apart.
 */
function roundPetal({
  ring,
  hub,
  nodes,
}: {
  ring: Ring
  hub: LayoutNode
  nodes: Map<string, LayoutNode>
}): Circle {
  const members = membersOf({ ring, nodes })
  const center = centroid(members)
  const r = Math.max(Math.hypot(hub.x - center.x, hub.y - center.y), MIN_R * 0.6)
  for (const node of members) {
    if (node === hub) continue
    const angle = Math.atan2(node.y - center.y, node.x - center.x)
    node.x = center.x + Math.cos(angle) * r
    node.y = center.y + Math.sin(angle) * r
  }
  return { center, r }
}

/** Rounds each of `rings` that hangs from a hub, and pins its variables there. */
function pinPetals({
  rings,
  all,
  nodes,
  pinned,
}: {
  rings: Ring[]
  all: Ring[]
  nodes: Map<string, LayoutNode>
  pinned: Set<string>
}): void {
  for (const ring of rings) {
    const hub = nodes.get(hubOf({ ring, rings: all }) ?? '')
    if (!hub) continue
    ring.circle = roundPetal({ ring, hub, nodes })
    ring.r = ring.circle.r
    for (const id of ring.members) pinned.add(id)
  }
}

/**
 * The circle a two-variable primary loop's members are opposite each other on. The crossing
 * search slides them round their circle, and a link can't take the long way round one.
 */
function across({ ring, nodes }: { ring: Ring; nodes: Map<string, LayoutNode> }): Circle {
  const [a, b] = membersOf({ ring, nodes })
  return { center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, r: Math.hypot(b.x - a.x, b.y - a.y) / 2 }
}

/**
 * The primary circle a loop of three or more variables shares exactly one link with, and the two
 * variables of that link in the loop's own order, when none of its other variables sits on a
 * circle already.
 */
function mirrorOf({ ring, rings }: { ring: Ring; rings: Ring[] }): {
  strong: Ring & { circle: Circle }
  shared: [string, string]
} | null {
  if (ring.circle || ring.members.length < 3) return null
  const k = ring.members.length
  for (const strong of rings) {
    if (!strong.circle) continue
    const common = ring.members.filter((id) => strong.members.includes(id))
    if (common.length !== 2) continue
    const i = ring.members.indexOf(common[0])
    const j = ring.members.indexOf(common[1])
    const adjacent = (j - i + k) % k === 1 || (i - j + k) % k === 1
    if (!adjacent) continue
    const own = ring.members.filter((id) => !common.includes(id))
    if (rings.some((r) => r.circle && own.some((id) => r.members.includes(id)))) continue
    const shared: [string, string] =
      (j - i + k) % k === 1 ? [common[0], common[1]] : [common[1], common[0]]
    return { strong: { ...strong, circle: strong.circle }, shared }
  }
  return null
}

/**
 * Draws a loop that shares one link with a primary circle as that circle's mirror image across
 * the link: the same size, through the same two variables, with its own variables spaced evenly
 * round the far side in loop order. Returns the variables it moved.
 */
function mirror({
  ring,
  rings,
  nodes,
}: {
  ring: Ring
  rings: Ring[]
  nodes: Map<string, LayoutNode>
}): string[] {
  const found = mirrorOf({ ring, rings })
  const from = found && nodes.get(found.shared[0])
  const to = found && nodes.get(found.shared[1])
  if (!(found && from && to)) return []
  const c1 = found.strong.circle.center
  const { r } = found.strong.circle
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }
  const center = { x: 2 * mid.x - c1.x, y: 2 * mid.y - c1.y }
  const angle = (p: Point) => Math.atan2(p.y - center.y, p.x - center.x)
  const far = Math.atan2(center.y - c1.y, center.x - c1.x)
  const start = angle(to)
  const ahead = (wrapAngle(angle(from) - start) + Math.PI * 2) % (Math.PI * 2)
  const sign = (wrapAngle(far - start) + Math.PI * 2) % (Math.PI * 2) < ahead ? 1 : -1
  const span = sign > 0 ? ahead : Math.PI * 2 - ahead
  const k = ring.members.length
  const after = ring.members.indexOf(found.shared[1])
  const own = Array.from({ length: k - 2 }, (_, i) => ring.members[(after + 1 + i) % k])
  own.forEach((id, i) => {
    const node = nodes.get(id)
    if (!node) return
    const a = start + (sign * span * (i + 1)) / (k - 1)
    node.x = center.x + Math.cos(a) * r
    node.y = center.y + Math.sin(a) * r
  })
  ring.circle = { center, r }
  ring.r = r
  return own
}

interface Nest {
  partner: Ring
  /** The two links both loops run, in order through the middle variable. */
  path: [number, number]
  ids: { s: string; m: string; e: string }
}

/** The two links two loops share, in travel order, when that's all they share and they meet. */
function sharedPath({
  ring,
  partner,
  links,
}: {
  ring: Ring
  partner: Ring
  links: Link[]
}): [number, number] | null {
  const shared = ring.loop.cycle.links.filter((i) => partner.loop.cycle.links.includes(i))
  if (shared.length !== 2) return null
  const [x, y] = shared
  if (links[x].to === links[y].from) return [x, y]
  return links[y].to === links[x].from ? [y, x] : null
}

/**
 * A loop of three or more that shares exactly two links in a row with a primary circle, and whose
 * middle variable no other loop passes through. Null when there's none.
 */
function nestOf({ ring, rings, links }: { ring: Ring; rings: Ring[]; links: Link[] }): Nest | null {
  if (!ring.circle || ring.members.length < 3) return null
  for (const partner of rings) {
    if (partner === ring || partner.circle || partner.members.length < 3) continue
    const common = partner.members.filter((id) => ring.members.includes(id))
    const path = common.length === 3 ? sharedPath({ ring, partner, links }) : null
    if (!path) continue
    const m = links[path[0]].to
    if (rings.some((r) => r !== ring && r !== partner && r.members.includes(m))) continue
    return { partner, path, ids: { s: links[path[0]].from, m, e: links[path[1]].to } }
  }
  return null
}

/** A ring's variables strictly between `from` and `to`, in travel order. */
function between({ ring, from, to }: { ring: Ring; from: string; to: string }): string[] {
  const k = ring.members.length
  const start = ring.members.indexOf(from)
  const out: string[] = []
  for (let i = 1; i < k; i++) {
    const id = ring.members[(start + i) % k]
    if (id === to) break
    out.push(id)
  }
  return out
}

/** The smallest circle a nest is drawn on, so each half of the S has room for its marker. */
const NEST_R = 150

/**
 * Draws two loops that share a path through one middle variable like a yin-yang: their own
 * variables round one circle, one loop's on each half, the ends of the shared path opposite each
 * other, and the path itself an S through the middle variable at the center. Returns the
 * variables it placed.
 */
function nest({
  ring,
  rings,
  links,
  nodes,
}: {
  ring: Ring
  rings: Ring[]
  links: Link[]
  nodes: Map<string, LayoutNode>
}): string[] {
  const found = nestOf({ ring, rings, links })
  if (!found) return []
  const { partner, path, ids } = found
  const at = (id: string): Point => nodes.get(id) ?? { x: 0, y: 0 }
  const own = [ring, partner].map((r) => between({ ring: r, from: ids.e, to: ids.s }))
  const outer = [ids.s, ids.e, ...own[0], ...own[1]].map(at)
  const center = centroid(outer)
  const r = Math.max(meanRadius(outer), NEST_R)
  const s0 = at(ids.s)
  const quarter = Math.PI / 2
  const end = Math.round((Math.atan2(s0.y - center.y, s0.x - center.x) + Math.PI) / quarter) * quarter
  const sideOf = (list: string[]) => {
    const p = centroid(list.map(at))
    return Math.sign(wrapAngle(Math.atan2(p.y - center.y, p.x - center.x) - end))
  }
  const sign = (own[0].length ? sideOf(own[0]) : -sideOf(own[1])) || 1
  const put = ({ id, angle, radius }: { id: string; angle: number; radius: number }) => {
    const node = nodes.get(id)
    if (!node) return
    node.x = center.x + Math.cos(angle) * radius
    node.y = center.y + Math.sin(angle) * radius
  }
  put({ id: ids.s, angle: end + Math.PI, radius: r })
  put({ id: ids.e, angle: end, radius: r })
  put({ id: ids.m, angle: 0, radius: 0 })
  own.forEach((list, side) => {
    const turn = side ? -sign : sign
    list.forEach((id, i) => {
      put({ id, angle: end + (turn * Math.PI * (i + 1)) / (list.length + 1), radius: r })
    })
  })
  const half = (p: Point) => ({ x: (p.x + center.x) / 2, y: (p.y + center.y) / 2 })
  const inner: Arc[] = [
    { link: path[0], center: half(at(ids.s)), sign },
    { link: path[1], center: half(at(ids.e)), sign: -sign },
  ]
  const rim = ({ of, turn }: { of: Ring; turn: number }): Arc[] =>
    of.loop.cycle.links.filter((i) => !path.includes(i)).map((link) => ({ link, center, sign: turn }))
  ring.arcs = [...inner, ...rim({ of: ring, turn: sign })]
  partner.arcs = [...inner, ...rim({ of: partner, turn: -sign })]
  for (const r2 of [ring, partner]) {
    r2.circle = { center, r }
    r2.r = r
  }
  return [ids.s, ids.m, ids.e, ...own[0], ...own[1]]
}

/** How far a variable already on another circle may sit off a loop's circle and still count as on it. */
const ON_CIRCLE = 6
/** The largest circle a loop is rounded onto; bigger ones sprawl across the drawing. */
const MAX_ROUND = 320
/** How far a free variable may move to reach the circle. */
const MAX_MOVE = 70
/** The smallest turn between neighbours round the circle, so no two bunch up. */
const MIN_TURN = 0.45

function det3(a: number[][]): number {
  return (
    a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) -
    a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) +
    a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0])
  )
}

/**
 * The circle nearest a set of points, the weighted ones held closest: a least-squares fit of
 * x² + y² + Dx + Ey + F = 0. Null when the points lie on a line.
 */
function fitCircle(points: { p: Point; w: number }[]): Circle | null {
  const m = [0, 1, 2].map(() => [0, 0, 0, 0])
  for (const { p, w } of points) {
    const row = [p.x, p.y, 1]
    const rhs = -(p.x * p.x + p.y * p.y)
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) m[i][j] += w * row[i] * row[j]
      m[i][3] += w * row[i] * rhs
    }
  }
  const base = m.map((row) => row.slice(0, 3))
  const d = det3(base)
  if (Math.abs(d) < 1e-9) return null
  const solve = (k: number) => det3(base.map((row, i) => row.map((v, j) => (j === k ? m[i][3] : v)))) / d
  const center = { x: -solve(0) / 2, y: -solve(1) / 2 }
  const r2 = center.x * center.x + center.y * center.y - solve(2)
  return r2 > 0 ? { center, r: Math.sqrt(r2) } : null
}

/** Whether variables at these points go round `circle` in their order, one way, none bunched. */
function goesRound({ points, circle }: { points: Point[]; circle: Circle }): boolean {
  const angles = points.map((p) => Math.atan2(p.y - circle.center.y, p.x - circle.center.x))
  const turns = angles.map((a, i) => wrapAngle(angles[(i + 1) % angles.length] - a))
  const sign = Math.sign(turns[0])
  return turns.every((t) => t * sign > MIN_TURN)
}

/**
 * The circle a loop's variables nearly lie on, when it passes through those already `fixed` on
 * other circles, takes the rest round it in loop order and moves none far. Null otherwise.
 */
function roundable({
  members,
  fixed,
  taken,
}: {
  members: LayoutNode[]
  fixed: Set<string>
  /** Circles other loops are on already: a loop on the same one would double up their links. */
  taken: Circle[]
}): Circle | null {
  const circle = fitCircle(members.map((n) => ({ p: n, w: fixed.has(n.id) ? 1000 : 1 })))
  if (!circle || circle.r > MAX_ROUND || circle.r < MIN_R * 0.6) return null
  const same = (c: Circle) =>
    Math.hypot(c.center.x - circle.center.x, c.center.y - circle.center.y) + Math.abs(c.r - circle.r) <
    circle.r * 0.25
  if (taken.some(same)) return null
  const off = (n: LayoutNode) =>
    Math.abs(Math.hypot(n.x - circle.center.x, n.y - circle.center.y) - circle.r)
  const fits = members.every((n) => off(n) <= (fixed.has(n.id) ? ON_CIRCLE : MAX_MOVE))
  return fits && goesRound({ points: members, circle }) ? circle : null
}

/**
 * Puts each loop of three or more that isn't round yet onto the circle its variables nearly lie
 * on (see `roundable`). Returns the variables it moved.
 */
function roundRest({
  rings,
  nodes,
  held,
}: {
  rings: Ring[]
  nodes: Map<string, LayoutNode>
  held: Set<string>
}): string[] {
  const moved: string[] = []
  const fixed = new Set(held)
  for (const ring of rings) {
    if (ring.circle || ring.members.length < 3) continue
    const members = membersOf({ ring, nodes })
    const taken = rings.flatMap((r) => (r.circle ? [r.circle] : []))
    const circle = roundable({ members, fixed, taken })
    if (!circle) continue
    for (const node of members.filter((n) => !fixed.has(n.id))) {
      const angle = Math.atan2(node.y - circle.center.y, node.x - circle.center.x)
      node.x = circle.center.x + Math.cos(angle) * circle.r
      node.y = circle.center.y + Math.sin(angle) * circle.r
      moved.push(node.id)
    }
    ring.circle = circle
    ring.r = circle.r
    for (const n of members) fixed.add(n.id)
  }
  return moved
}

/** The shortest and longest diameter of a touching two-variable loop's circle. */
const TOUCH = { min: 150, max: 190 }

/**
 * Puts the other variable of each two-variable loop that touches a primary circle straight out
 * from the variable they share, so the loop's own circle meets that one at a tangent. Returns
 * the variables it moved.
 */
function touch({ nodes, rings }: { nodes: Map<string, LayoutNode>; rings: Ring[] }): string[] {
  return rings.flatMap((ring) => {
    const kiss = kissOf({ ring, rings })
    const circle = kiss?.strong.circle
    if (!(kiss && circle)) return []
    const p = nodes.get(kiss.shared)
    const q = nodes.get(kiss.other)
    if (!(p && q)) return []
    const out = Math.atan2(p.y - circle.center.y, p.x - circle.center.x)
    const d = Math.min(TOUCH.max, Math.max(TOUCH.min, Math.hypot(q.x - p.x, q.y - p.y)))
    q.x = p.x + Math.cos(out) * d
    q.y = p.y + Math.sin(out) * d
    return [kiss.other]
  })
}

/**
 * Runs the crossing search STARTS times, from the settled layout and from shaken copies of it,
 * and keeps the layout that scored best.
 */
function searchFrom({
  nodes,
  pinned,
  rng,
  run,
}: {
  nodes: LayoutNode[]
  pinned: Set<string>
  rng: Rng
  run: () => number
}): void {
  const settled = snapshot(nodes)
  let best = { cost: Infinity, at: settled }
  for (let start = 0; start < STARTS; start++) {
    restore({ nodes, at: settled })
    if (start) jitter({ nodes, pinned, rng })
    const cost = run()
    if (cost < best.cost) best = { cost, at: snapshot(nodes) }
  }
  restore({ nodes, at: best.at })
}

function snapshot(nodes: LayoutNode[]): Point[] {
  return nodes.map((node) => ({ x: node.x, y: node.y }))
}

function restore({ nodes, at }: { nodes: LayoutNode[]; at: Point[] }): void {
  nodes.forEach((node, i) => {
    node.x = at[i].x
    node.y = at[i].y
  })
}

/** Shakes the free variables loose, so another search starts somewhere new. */
function jitter({
  nodes,
  pinned,
  rng,
}: {
  nodes: LayoutNode[]
  pinned: Set<string>
  rng: Rng
}): void {
  for (const node of nodes) {
    if (pinned.has(node.id)) continue
    node.x += rng.normal() * SHAKE
    node.y += rng.normal() * SHAKE
  }
  for (let pass = 0; pass < 30; pass++) collide({ nodes, pad: 20, strength: 1, pinned })
}

/** Evens the placed layout out with d3-force: springs, charge, the ring and clear forces, collision. */
function simulate({
  nodes,
  byId,
  links,
  rings,
  rng,
}: {
  nodes: LayoutNode[]
  byId: Map<string, LayoutNode>
  links: Link[]
  rings: Ring[]
  rng: Rng
}): void {
  const sim = forceSimulation<LayoutNode>(nodes)
    .randomSource(() => rng.next())
    .velocityDecay(0.45)
    .force(
      'links',
      forceLink<LayoutNode, SimLink>(springs({ links, nodes: byId }))
        .id((node) => node.id)
        .distance((l) => l.distance)
        .strength((l) => l.strength),
    )
    .force('charge', forceManyBody<LayoutNode>().strength(-220).distanceMax(300))
    .force('ring', ringForce({ rings, nodes: byId }))
    .force('clear', clearForce({ rings, nodes: byId }))
    .force('x', forceX<LayoutNode>(0).strength(0.01))
    .force('y', forceY<LayoutNode>(0).strength(0.015))
    .stop()
  for (let tick = 0; tick < 300; tick++) {
    sim.tick()
    collide({ nodes, pad: 20, strength: 0.7 })
  }
  for (let pass = 0; pass < 60; pass++) collide({ nodes, pad: 20, strength: 1 })
}

/** The room a node keeps for itself and its label. */
export function nodeBox(node: LayoutNode): Box {
  return boxAt({ center: node, w: node.w, h: node.h })
}

/** The square around a node's dot. */
export function dotBox(node: LayoutNode): Box {
  return boxAt({ center: node, w: node.r * 2, h: node.r * 2 })
}

/** Whether `p` is within `pad` of a node's dot. */
export function onDot({ node, p, pad }: { node: LayoutNode; p: Point; pad: number }): boolean {
  return Math.hypot(p.x - node.x, p.y - node.y) <= node.r + pad
}

/** Moves the variables inside each peripheral run onto its circle, so the run reads as one arc. */
function lineUp({
  nodes,
  links,
  rings,
}: {
  nodes: Map<string, LayoutNode>
  links: Link[]
  rings: Ring[]
}): void {
  for (const run of peripheralRuns({ nodes, links, rings })) {
    const { center, r } = run.circle
    for (const id of run.ids.slice(1, -1)) {
      const node = nodes.get(id)
      if (!node) continue
      const angle = Math.atan2(node.y - center.y, node.x - center.x)
      node.x = center.x + Math.cos(angle) * r
      node.y = center.y + Math.sin(angle) * r
    }
  }
}
