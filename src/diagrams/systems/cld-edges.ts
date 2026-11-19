import type { Point } from '../../core/geometry.ts'
import type { Swatch } from '../../theme/index.ts'
import {
  type Curve,
  curveExit,
  curveHeading,
  curvePoint,
  curveSamples,
  curveStep,
} from './link-arc.ts'
import { type LayoutNode, onDot, type Ring } from './cld-layout.ts'
import { byPriority, routes } from './cld-routes.ts'
import type { Trend } from './trend.ts'
import type { Link, NamedLoop } from './model.ts'

/**
 * Causal links as drawn: the curves cld-routes.ts gives them, trimmed to the variables' dots,
 * with the tip and heading for the arrowhead and the color of the loop they belong to.
 */

export interface LoopView {
  ring: Ring
  loop: NamedLoop
  swatch: Swatch
  center: Point
  clockwise: boolean
  /** The behaviour over time drawn under the loop's name. */
  trend?: Trend
}

export interface Edge {
  /** Index into the link list. */
  index: number
  link: Link
  curve: Curve
  t0: number
  t1: number
  tip: Point
  heading: number
  /** Points along the drawn part, for collision checks. */
  samples: Point[]
  color: Swatch | null
  owner: LoopView | null
}

/** Signed distance of `p` from the line a→b: positive to the left of travel, on screen. */
export function leftOf({ a, b, p }: { a: Point; b: Point; p: Point }): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const d = Math.hypot(dx, dy) || 1
  return ((p.x - (a.x + b.x) / 2) * dy - (p.y - (a.y + b.y) / 2) * dx) / d
}

function trimmed({ curve, from, to }: { curve: Curve; from: LayoutNode; to: LayoutNode }) {
  const t0 = curveExit({ curve, within: (p) => onDot({ node: from, p, pad: 4 }), from: 0, to: 1 })
  const tipT = curveExit({ curve, within: (p) => onDot({ node: to, p, pad: 3 }), from: 1, to: 0 })
  return { t0, t1: Math.max(t0, tipT - curveStep({ curve, distance: 6 })), tipT }
}

/** Views come by importance, as `loops` lists them. */
export function buildEdges({
  links,
  nodes,
  views,
  tint,
}: {
  links: Link[]
  nodes: Map<string, LayoutNode>
  views: LoopView[]
  tint: boolean
}): Edge[] {
  const rings = byPriority({ rings: views.map((v) => v.ring), loops: views.map((v) => v.loop) })
  return routes({ nodes, links, rings }).flatMap((route) => {
    if (!route) return []
    const link = links[route.index]
    const from = nodes.get(link.from)
    const to = nodes.get(link.to)
    if (!from || !to) return []
    const { curve } = route
    const { t0, t1, tipT } = trimmed({ curve, from, to })
    const owner = views.find((v) => v.ring === route.owner) ?? null
    return [
      {
        index: route.index,
        link,
        curve,
        t0,
        t1,
        tip: curvePoint({ curve, t: tipT }),
        heading: curveHeading({ curve, t: tipT }),
        samples: curveSamples({ curve, t0, t1: tipT }),
        color: tint && owner ? owner.swatch : null,
        owner,
      },
    ]
  })
}
