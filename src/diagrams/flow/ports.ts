import type { ElkPort } from 'elkjs/lib/elk.bundled.js'
import type { Size } from './layout.ts'
import type { Direction, FlowModel, Shape } from './model.ts'

type Side = 'NORTH' | 'EAST' | 'SOUTH' | 'WEST'

/** Shapes whose edges should meet them at their points, not anywhere along their bounding box. */
const POINTED = new Set<Shape>(['diamond', 'choice'])
const ROUND = new Set<Shape>(['circle', 'doublecircle', 'start', 'end'])

/** The side edges arrive on, then the sides they leave by in order of preference. */
const SIDES: Record<Direction, { into: Side; out: Side[] }> = {
  TB: { into: 'NORTH', out: ['SOUTH', 'EAST', 'WEST'] },
  BT: { into: 'SOUTH', out: ['NORTH', 'EAST', 'WEST'] },
  LR: { into: 'WEST', out: ['EAST', 'SOUTH', 'NORTH'] },
  RL: { into: 'EAST', out: ['WEST', 'SOUTH', 'NORTH'] },
}

function portAt({ side, size }: { side: Side; size: Size }): { x: number; y: number } {
  if (side === 'NORTH') return { x: size.w / 2, y: 0 }
  if (side === 'SOUTH') return { x: size.w / 2, y: size.h }
  if (side === 'EAST') return { x: size.w, y: size.h / 2 }
  return { x: 0, y: size.h / 2 }
}

export interface PortPlan {
  /** Ports to add to each ELK node, keyed by node id. */
  ports: Map<string, ElkPort[]>
  /** The port an edge leaves from and arrives at, by edge index, when it uses one. */
  source: Map<number, string>
  target: Map<number, string>
}

/**
 * Pins edges to the vertices of diamonds and the poles of circles: in on the side facing the
 * flow, out on the far side, a decision's second and third branches out its flanks.
 */
export function planPorts({
  model,
  sizes,
  skip,
}: {
  model: FlowModel
  sizes: Map<string, Size>
  /** Edges left free to attach anywhere, such as those running against the flow. */
  skip: Set<number>
}): PortPlan {
  const plan: PortPlan = { ports: new Map(), source: new Map(), target: new Map() }
  const sides = SIDES[model.direction]
  const used = new Map<string, Set<Side>>()
  const shapeOf = new Map(model.nodes.map((node) => [node.id, node.shape]))
  const outCount = new Map<string, number>()
  const use = ({ id, side }: { id: string; side: Side }): string => {
    const set = used.get(id) ?? new Set<Side>()
    used.set(id, set)
    set.add(side)
    return `n:${id}|${side}`
  }
  model.edges.forEach((edge, i) => {
    if (edge.from === edge.to || skip.has(i)) return
    const from = shapeOf.get(edge.from)
    const to = shapeOf.get(edge.to)
    if (from && (POINTED.has(from) || ROUND.has(from))) {
      const k = outCount.get(edge.from) ?? 0
      outCount.set(edge.from, k + 1)
      const side = POINTED.has(from) ? sides.out[k % 3] : sides.out[0]
      plan.source.set(i, use({ id: edge.from, side }))
    }
    if (to && (POINTED.has(to) || ROUND.has(to)))
      plan.target.set(i, use({ id: edge.to, side: sides.into }))
  })
  for (const [id, set] of used) {
    const size = sizes.get(id) ?? { w: 0, h: 0 }
    plan.ports.set(
      id,
      [...set].map((side) => ({
        id: `n:${id}|${side}`,
        width: 0,
        height: 0,
        ...portAt({ side, size }),
        layoutOptions: { 'elk.port.side': side },
      })),
    )
  }
  return plan
}

/** The ELK node a port or node id belongs to. */
export function ownerOf(id: string): string {
  const bar = id.indexOf('|')
  return bar < 0 ? id : id.slice(0, bar)
}
