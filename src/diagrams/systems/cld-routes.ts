import type { Point } from '../../core/geometry.ts'
import type { Circle, LayoutNode, Ring } from './cld-layout.ts'
import { type Curve, curveBetween } from './link-arc.ts'
import type { Link, NamedLoop } from './model.ts'
import { centroid, wrapAngle } from './vec.ts'

/**
 * How causal links run. Every link is a curve with a set heading at each end. Rings come in
 * priority order, and a variable's primary loop is the first ring through it: that loop's links
 * in and out share one heading there, so the loop passes through smoothly. A link takes its
 * heading at a variable from the strongest loop it belongs to or continues there, so a loop
 * that branches off another leaves along it. Links meeting a variable from nearly the same
 * direction are then spread apart so their lines and arrowheads stay distinct.
 */

export interface Route {
  index: number
  curve: Curve
  /** The first ring the link is on, which colors it. */
  owner: Ring | null
}

/** Least angle between two links at one variable. */
const SPREAD = 0.35
/** A loop heading that turns this far from the chord loops back on itself, so the link's own loop shapes it instead. */
const TOO_SHARP = 1.5
/** A link follows a stronger loop's heading only when its own loop heads within this much of it. */
const FOLLOW = 1
/** How much further than a semicircle the free side of a riding two-variable loop bulges. */
const RIDE = 1.5
/** How far a link on no loop bows from its chord at each end. */
const BOW = 0.35

interface End {
  index: number
  id: string
  out: boolean
  chord: number
  heading: number
  rank: number
  /** Keeps its heading when spread: it's on a touching circle, which bending would break. */
  locked?: boolean
}

interface Routing {
  at: (id: string) => Point
  rings: Ring[]
  links: Link[]
  owners: (Ring | null)[]
  signs: Map<Ring, number>
  middle: Point
  /** The circle and turning sense each link of a peripheral run follows, by link index. */
  runs: Map<number, { center: Point; sign: number; locked: boolean }>
}

/** A stretch of a loop that no stronger loop draws, between the variables where it meets them. */
export interface Run {
  ids: string[]
  links: number[]
  circle: Circle
  /** Set for a touching two-variable loop, whose turning sense is fixed and whose ends aren't spread. */
  sign?: number
}

/**
 * The runs of each loop that isn't a primary circle: its links that it draws itself, taken in
 * order and split where a stronger loop's link comes between. Each run follows a circle through
 * its ends fitted to the whole loop, so a loop's separate stretches read as arcs of one circle.
 * A two-variable loop gets a circle only when it touches a primary one (see kissRun): a circle
 * through a variable it shares would otherwise cut through the loop it shares with.
 */
export function peripheralRuns({
  nodes,
  links,
  rings,
}: {
  nodes: Map<string, LayoutNode>
  links: Link[]
  rings: Ring[]
}): Run[] {
  const owners = ownersOf({ links, rings })
  const at = (id: string): Point => nodes.get(id) ?? { x: 0, y: 0 }
  const middle = centroid([...nodes.values()])
  const turning = (ring: Ring) => orientation({ ring, at, owners, middle })
  return rings.flatMap((ring) => {
    if (ring.circle) return []
    if (ring.members.length === 2) return kissRun({ ring, rings, links, at, turning })
    return chainRuns({ ring, owners, links, at })
  })
}

/** How far the layout's touching variable may sit from straight out before the loop isn't drawn as touching. */
const ALIGNED = 0.05

/**
 * A two-variable loop that meets a primary circle at one variable and has its other variable to
 * itself: drawn as its own circle touching that one, like a figure eight.
 */
export function kissOf({ ring, rings }: { ring: Ring; rings: Ring[] }): {
  shared: string
  other: string
  strong: Ring
} | null {
  if (ring.circle || ring.members.length !== 2) return null
  const strong = rings.find(
    (r) => r.circle && r.members.filter((id) => ring.members.includes(id)).length === 1,
  )
  if (!strong) return null
  const [shared, other] = strong.members.includes(ring.members[0])
    ? ring.members
    : [ring.members[1], ring.members[0]]
  if (rings.some((r) => r !== ring && r.members.includes(other))) return null
  return { shared, other, strong }
}

/**
 * The circle a touching two-variable loop runs round: the one whose diameter joins its variables,
 * once the layout has put the other straight out from the circle it touches. It turns the same
 * way as that circle (`turning` gives a ring's sense), so the two pass the shared variable in
 * opposite directions.
 */
function kissRun({
  ring,
  rings,
  links,
  at,
  turning,
}: {
  ring: Ring
  rings: Ring[]
  links: Link[]
  at: (id: string) => Point
  turning: (ring: Ring) => number
}): Run[] {
  const kiss = kissOf({ ring, rings })
  const circle = kiss?.strong.circle
  if (!(kiss && circle)) return []
  const p = at(kiss.shared)
  const q = at(kiss.other)
  const out = Math.atan2(p.y - circle.center.y, p.x - circle.center.x)
  if (Math.abs(wrapAngle(Math.atan2(q.y - p.y, q.x - p.x) - out)) > ALIGNED) return []
  const [first, second] = ring.loop.cycle.links
  const ids = [links[first].from, links[first].to, links[second].to]
  const center = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }
  const r = Math.hypot(q.x - p.x, q.y - p.y) / 2
  return [{ ids, links: [first, second], circle: { center, r }, sign: turning(kiss.strong) }]
}

function chainRuns({
  ring,
  owners,
  links,
  at,
}: {
  ring: Ring
  owners: (Ring | null)[]
  links: Link[]
  at: (id: string) => Point
}): Run[] {
  const cycle = ring.loop.cycle.links
  const k = cycle.length
  const mine = (pos: number) => owners[cycle[(pos + k) % k]] === ring
  const first = cycle.findIndex((_, pos) => mine(pos) && !mine(pos - 1))
  if (first < 0) return []
  const out: Run[] = []
  let current: number[] = []
  for (let step = 0; step <= k; step++) {
    const pos = (first + step) % k
    if (step < k && mine(pos)) current.push(cycle[pos])
    else if (current.length) {
      out.push(...runOf({ chain: current, links, at, members: ring.members }))
      current = []
    }
  }
  return out
}

function runOf({
  chain,
  links,
  at,
  members,
}: {
  chain: number[]
  links: Link[]
  at: (id: string) => Point
  members: string[]
}): Run[] {
  const ids = [links[chain[0]].from, ...chain.map((i) => links[i].to)]
  const ends = [ids[0], ids[ids.length - 1]]
  const others = members.filter((id) => !ends.includes(id)).map(at)
  const circle = fitThrough({ a: at(ends[0]), b: at(ends[1]), others })
  return circle ? [{ ids, links: chain, circle }] : []
}

/**
 * The circle through a and b that passes nearest `others`: its center slides along their
 * perpendicular bisector to the spot where the others stray least from it.
 */
function fitThrough({ a, b, others }: { a: Point; b: Point; others: Point[] }): Circle | null {
  const half = Math.hypot(b.x - a.x, b.y - a.y) / 2
  if (half < 1 || !others.length) return null
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  const perp = { x: -(b.y - a.y) / (2 * half), y: (b.x - a.x) / (2 * half) }
  const centerAt = (s: number) => ({ x: mid.x + perp.x * s, y: mid.y + perp.y * s })
  const stray = (s: number) => {
    const c = centerAt(s)
    const r = Math.hypot(half, s)
    return others.reduce((sum, p) => sum + (Math.hypot(p.x - c.x, p.y - c.y) - r) ** 2, 0)
  }
  let best = 0
  let span = half * 6
  for (let round = 0; round < 4; round++) {
    let bestCost = Infinity
    const from = best - span
    for (let i = 0; i <= 24; i++) {
      const s = from + (2 * span * i) / 24
      const cost = stray(s)
      if (cost < bestCost) {
        bestCost = cost
        best = s
      }
    }
    span /= 8
  }
  return { center: centerAt(best), r: Math.hypot(half, best) }
}

function ownersOf({ links, rings }: { links: Link[]; rings: Ring[] }): (Ring | null)[] {
  return links.map((_, i) => rings.find((r) => r.loop.cycle.links.includes(i)) ?? null)
}

/** Which way a run goes round its circle, from its first variable toward its second. */
function runSign({ run, at }: { run: Run; at: (id: string) => Point }): number {
  const { center } = run.circle
  const angle = (p: Point) => Math.atan2(p.y - center.y, p.x - center.x)
  return wrapAngle(angle(at(run.ids[1])) - angle(at(run.ids[0]))) >= 0 ? 1 : -1
}

/**
 * Which way a two-variable ring runs: the way that bows its own links (those no stronger loop
 * draws) out from the middle of the diagram, so it doesn't fold into the loop it shares with.
 */
function twoWay({
  ring,
  at,
  owners,
  middle,
}: {
  ring: Ring
  at: (id: string) => Point
  owners: (Ring | null)[]
  middle: Point
}): number {
  const [a, b] = ring.members.map(at)
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  const r = Math.hypot(b.x - a.x, b.y - a.y) / 2
  const bulge = (sign: number) =>
    ring.loop.cycle.links.reduce((sum, index, i) => {
      if (owners[index] !== ring) return sum
      const p = i === 0 ? a : b
      const angle = Math.atan2(p.y - mid.y, p.x - mid.x) + (sign * Math.PI) / 2
      const top = { x: mid.x + Math.cos(angle) * r, y: mid.y + Math.sin(angle) * r }
      return sum + Math.hypot(top.x - middle.x, top.y - middle.y)
    }, 0)
  return bulge(1) >= bulge(-1) ? 1 : -1
}

/** +1 when the ring runs clockwise on screen (angles growing), else -1. */
function orientation({
  ring,
  at,
  owners,
  middle,
}: {
  ring: Ring
  at: (id: string) => Point
  owners: (Ring | null)[]
  middle: Point
}): number {
  if (ring.members.length < 3) return twoWay({ ring, at, owners, middle })
  const points = ring.members.map(at)
  const c = centroid(points)
  const angles = points.map((p) => Math.atan2(p.y - c.y, p.x - c.x))
  const sum = angles.reduce((s, a, i) => s + wrapAngle(angles[(i + 1) % angles.length] - a), 0)
  return sum >= 0 ? 1 : -1
}

function circumcenter({ a, b, c }: { a: Point; b: Point; c: Point }): Point | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y))
  if (Math.abs(d) < 1e-6) return null
  const a2 = a.x * a.x + a.y * a.y
  const b2 = b.x * b.x + b.y * b.y
  const c2 = c.x * c.x + c.y * c.y
  return {
    x: (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d,
    y: (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d,
  }
}

/** Heading around a circle at `p`, turning clockwise on screen when `sign` is +1. */
function around({ p, center, sign }: { p: Point; center: Point; sign: number }): number {
  return Math.atan2(p.y - center.y, p.x - center.x) + (sign * Math.PI) / 2
}

/**
 * A ring's heading at one of its variables: along its circle for a primary ring, else along the
 * circle through the variable and its two neighbours in the loop.
 */
function loopHeading({ id, ring, routing }: { id: string; ring: Ring; routing: Routing }): number {
  const { at } = routing
  const cycle = ring.members
  const k = cycle.length
  const i = cycle.indexOf(id)
  const p = at(id)
  const sign = routing.signs.get(ring) ?? 1
  if (ring.circle) return around({ p, center: ring.circle.center, sign })
  const prev = at(cycle[(i - 1 + k) % k])
  const next = at(cycle[(i + 1) % k])
  if (k === 2) return around({ p, center: { x: (p.x + next.x) / 2, y: (p.y + next.y) / 2 }, sign })
  const center = circumcenter({ a: prev, b: p, c: next })
  if (!center) return Math.atan2(next.y - prev.y, next.x - prev.x)
  const cross = (p.x - prev.x) * (next.y - p.y) - (p.y - prev.y) * (next.x - p.x)
  return around({ p, center, sign: cross >= 0 ? 1 : -1 })
}

/** The link that carries `ring` on through the variable at one end of link `index`. */
function continuation({ ring, index, out }: { ring: Ring; index: number; out: boolean }): number {
  const { links } = ring.loop.cycle
  const k = links.length
  const pos = links.indexOf(index)
  return out ? links[(pos - 1 + k) % k] : links[(pos + 1) % k]
}

/** The heading a link on no loop takes at one end: bowing away from the middle of the diagram. */
function bowHeading({
  from,
  to,
  out,
  middle,
}: {
  from: Point
  to: Point
  out: boolean
  middle: Point
}): number {
  const chord = Math.atan2(to.y - from.y, to.x - from.x)
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }
  const normal = { x: -(to.y - from.y), y: to.x - from.x }
  const side = (middle.x - mid.x) * normal.x + (middle.y - mid.y) * normal.y > 0 ? -1 : 1
  return out ? chord + side * BOW : chord - side * BOW
}

function endOf({ index, out, routing }: { index: number; out: boolean; routing: Routing }): End {
  const { at, rings, links, owners } = routing
  const link = links[index]
  const id = out ? link.from : link.to
  const from = at(link.from)
  const to = at(link.to)
  const chord = Math.atan2(to.y - from.y, to.x - from.x)
  const own = owners[index]
  const rank = own ? rings.indexOf(own) : rings.length
  const run = routing.runs.get(index)
  if (run)
    return {
      index,
      id,
      out,
      chord,
      heading: around({ p: at(id), center: run.center, sign: run.sign }),
      rank,
      locked: run.locked,
    }
  if (!own)
    return {
      index,
      id,
      out,
      chord,
      heading: bowHeading({ from, to, out, middle: routing.middle }),
      rank,
    }
  const containing = rings.filter((r) => r.loop.cycle.links.includes(index))
  const carried = containing.flatMap((r) => owners[continuation({ ring: r, index, out })] ?? [])
  const lead = [...containing, ...carried].reduce((a, b) =>
    rings.indexOf(b) < rings.indexOf(a) ? b : a,
  )
  const mine = loopHeading({ id, ring: own, routing })
  const led = loopHeading({ id, ring: lead, routing })
  const follows =
    Math.abs(wrapAngle(led - mine)) < FOLLOW && Math.abs(wrapAngle(led - chord)) <= TOO_SHARP
  return { index, id, out, chord, heading: follows ? led : mine, rank }
}

/** Turns lower-priority ends at one variable until every pair is at least SPREAD apart. */
function spread(ends: End[]): void {
  const ray = (end: End) => (end.out ? end.heading : end.heading + Math.PI)
  const placed: number[] = []
  for (const end of [...ends].sort((a, b) => a.rank - b.rank || a.index - b.index)) {
    const angle = end.locked ? ray(end) : clear({ end, start: ray(end), placed })
    placed.push(angle)
    end.heading = end.out ? angle : angle - Math.PI
  }
}

/** The ray nearest `start` that's SPREAD clear of every placed one, within a few turns. */
function clear({ end, start, placed }: { end: End; start: number; placed: number[] }): number {
  let angle = start
  for (let tries = 0; tries < 4; tries++) {
    const clash = placed.find((other) => Math.abs(wrapAngle(angle - other)) < SPREAD)
    if (clash === undefined) break
    const side = Math.sign(wrapAngle(angle - clash))
    const options = [clash + SPREAD, clash - SPREAD]
    const turn = (a: number) => Math.abs(wrapAngle((end.out ? a : a - Math.PI) - end.chord))
    const nearer = turn(options[0]) <= turn(options[1]) ? options[0] : options[1]
    const away = clash + side * SPREAD
    angle = side && turn(away) <= TOO_SHARP ? away : nearer
  }
  return angle
}

/** Every link's curve, by link index; null for a link that can't be drawn (a self-link, an unknown variable). */
export function routes({
  nodes,
  links,
  rings,
}: {
  nodes: Map<string, LayoutNode>
  links: Link[]
  rings: Ring[]
}): (Route | null)[] {
  const at = (id: string): Point => nodes.get(id) ?? { x: 0, y: 0 }
  const owners = ownersOf({ links, rings })
  const middle = centroid([...nodes.values()])
  const runs = new Map<number, { center: Point; sign: number; locked: boolean }>()
  for (const run of peripheralRuns({ nodes, links, rings }))
    for (const index of run.links)
      runs.set(index, {
        center: run.circle.center,
        sign: run.sign ?? runSign({ run, at }),
        locked: run.sign !== undefined,
      })
  for (const ring of rings)
    for (const arc of ring.arcs ?? [])
      runs.set(arc.link, { center: arc.center, sign: arc.sign, locked: false })
  const routing: Routing = {
    at,
    rings,
    links,
    owners,
    signs: new Map(rings.map((ring) => [ring, orientation({ ring, at, owners, middle })])),
    middle,
    runs,
  }
  const drawable = (link: Link) =>
    nodes.has(link.from) && nodes.has(link.to) && link.from !== link.to
  const ends = links.flatMap((link, index) =>
    drawable(link)
      ? [endOf({ index, out: true, routing }), endOf({ index, out: false, routing })]
      : [],
  )
  const byNode = new Map<string, End[]>()
  for (const end of ends) byNode.set(end.id, [...(byNode.get(end.id) ?? []), end])
  for (const group of byNode.values()) spread(group)
  return links.map((link, index) => {
    const start = ends.find((e) => e.index === index && e.out)
    const finish = ends.find((e) => e.index === index && !e.out)
    if (!start || !finish) return null
    const curve = curveBetween({
      from: at(link.from),
      to: at(link.to),
      start: start.heading,
      end: finish.heading,
      stretch: riding({ index, owners }) ? RIDE : 1,    })
    return { index, curve, owner: routing.owners[index] }
  })
}

/**
 * Whether a link is the free side of a two-variable loop whose other side a stronger loop draws.
 * Bowed as a semicircle it would hug that loop's arc and leave no room inside, so it bulges more.
 */
function riding({ index, owners }: { index: number; owners: (Ring | null)[] }): boolean {
  const own = owners[index]
  return Boolean(
    own && own.members.length === 2 && own.loop.cycle.links.some((i) => owners[i] !== own),
  )
}

/** Rings in the order their headings win: primary circles first, then as `loops` lists them. */
export function byPriority({ rings, loops }: { rings: Ring[]; loops: NamedLoop[] }): Ring[] {
  const key = (ring: Ring) => (ring.circle ? 0 : 1)
  return [...rings].sort((a, b) => key(a) - key(b) || loops.indexOf(a.loop) - loops.indexOf(b.loop))
}
