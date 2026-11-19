import type { Point } from '../../core/geometry.ts'
import type { Diagnostic } from '../../core/parse.ts'
import type { Edge } from './cld-edges.ts'
import type { LayoutNode } from './cld-layout.ts'

/** Crossings a reader shrugs off; from the readability sweep, clean drawings had at most one. */
const CROSSINGS_OK = 2
/** How close to a dot two links may cross and still read as meeting there. */
const AT_DOT = 22
/** Crossings closer than this are one place where several samples of the same two curves meet. */
const SAME_SPOT = 25

function side({ a, b, p }: { a: Point; b: Point; p: Point }): number {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
}

function crosses({ one, two }: { one: [Point, Point]; two: [Point, Point] }): boolean {
  const [a, b] = one
  const [c, d] = two
  return side({ a, b, p: c }) * side({ a, b, p: d }) < 0 && side({ a: c, b: d, p: a }) * side({ a: c, b: d, p: b }) < 0
}

/** Where two links cross away from every dot, one point per crossing. */
function crossingSpots({ one, two, nodes }: { one: Point[]; two: Point[]; nodes: LayoutNode[] }): Point[] {
  const atDot = (p: Point) => nodes.some((n) => Math.hypot(p.x - n.x, p.y - n.y) < n.r + AT_DOT)
  const spots: Point[] = []
  for (let s = 1; s < one.length; s++)
    for (let t = 1; t < two.length; t++) {
      const p = one[s]
      const hit = crosses({ one: [one[s - 1], p], two: [two[t - 1], two[t]] })
      if (hit && !atDot(p) && !spots.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < SAME_SPOT)) spots.push(p)
    }
  return spots
}

/** Variables a link runs through without starting or ending there: it reads as connected to them. */
function runsThrough({ edge, nodes }: { edge: Edge; nodes: LayoutNode[] }): LayoutNode[] {
  const { from, to } = edge.link
  return nodes.filter(
    (n) => n.id !== from && n.id !== to && edge.samples.some((p) => Math.hypot(p.x - n.x, p.y - n.y) < n.r + 2),
  )
}

/**
 * Looks at the finished drawing for what makes a causal loop diagram hard to follow, links crossing
 * and links running through other variables, and warns with what it found. Size limits catch most
 * tangles before layout; this catches the ones that fit the limits and still came out knotted.
 */
export function tangles({ edges, nodes }: { edges: Edge[]; nodes: LayoutNode[] }): Diagnostic[] {
  let crossings = 0
  edges.forEach((a, i) => {
    for (const b of edges.slice(i + 1)) crossings += crossingSpots({ one: a.samples, two: b.samples, nodes }).length
  })
  const through = edges.flatMap((edge) =>
    runsThrough({ edge, nodes }).map((n) => ({ line: edge.link.line, text: `${edge.link.from} → ${edge.link.to} runs through "${n.id}"` })),
  )
  const problems = [
    crossings > CROSSINGS_OK && `${crossings} places where links cross`,
    ...through.map((t) => t.text),
  ].filter((p) => typeof p === 'string')
  if (!problems.length) return []
  return [
    {
      line: through[0]?.line ?? 1,
      severity: 'warning',
      message: `The drawing came out tangled: ${problems.join('; ')}. Readers may misread it. Drop or merge variables, cut links that close no loop, or split it into smaller diagrams.`,
    },
  ]
}
