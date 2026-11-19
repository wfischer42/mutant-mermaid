import type ELK from 'elkjs/lib/elk.bundled.js'
import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk.bundled.js'
import type { Point } from '../../core/geometry.ts'
import type { Direction, FlowCluster, FlowEdge, FlowModel } from './model.ts'
import { ownerOf, type PortPlan, planPorts } from './ports.ts'
import type { Box } from './shapes.ts'

export interface Size {
  w: number
  h: number
}

export interface PlacedEdge {
  edge: FlowEdge
  points: Point[]
}

export interface Layout {
  width: number
  height: number
  nodes: Map<string, Box>
  clusters: Map<string, Box>
  edges: PlacedEdge[]
}

const ELK_DIRECTION: Record<Direction, string> = {
  TB: 'DOWN',
  BT: 'UP',
  LR: 'RIGHT',
  RL: 'LEFT',
}

let engine: Promise<InstanceType<typeof ELK>> | null = null

/** The layout engine, loaded on first use: it's a large bundle that only flowcharts need. */
function elk(): Promise<InstanceType<typeof ELK>> {
  engine ??= import('elkjs/lib/elk.bundled.js').then(({ default: Elk }) => new Elk())
  return engine
}

/** Space a cluster keeps around its contents; the top holds its title. */
export const CLUSTER_PAD = { top: 42, side: 18, bottom: 18 }

/** Space a concurrent region keeps around its states, on every side. */
const REGION_PAD = 14

function rootOptions({ direction, span }: { direction: Direction; span: LabelSpan }): Record<string, string> {
  return {
    'elk.algorithm': 'layered',
    'elk.direction': ELK_DIRECTION[direction],
    'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
    'org.eclipse.elk.json.edgeCoords': 'ROOT',
    'elk.edgeRouting': 'ORTHOGONAL',
    ...spacing({ direction, span }),
    'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
    'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED',
    'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST',
    'elk.layered.crossingMinimization.forceNodeModelOrder': 'false',
    'elk.layered.thoroughness': '12',
    'elk.spacing.componentComponent': '48',
    'elk.padding': '[top=24,left=24,bottom=24,right=24]',
  }
}

/** The largest edge label, and whether a labelled edge has a twin running the other way. */
interface LabelSpan extends Size {
  twoWay: boolean
}

/** Room an edge label keeps clear at each end, for the arrowhead and its lead-in. */
const LABEL_CLEAR = 18

/**
 * Spacing for the graph and every cluster: ELK reads these per level of nesting. Labels aren't
 * given to ELK, which would make each one a node of its own; instead the gap between layers
 * grows to fit the largest, `span`, so a label drawn on its edge's curve has room. Where a
 * two-way link has labels, a vertical gap fits two, one above the other: its lines run too close
 * to hold them side by side. (Across, they sit above and below the lines instead.)
 */
function spacing({ direction, span }: { direction: Direction; span: LabelSpan }): Record<string, string> {
  const across = direction === 'LR' || direction === 'RL'
  const stacked = span.twoWay ? span.h * 2 + 8 : span.h
  const fit = (across ? span.w : stacked) + LABEL_CLEAR * 2
  return {
    'elk.layered.spacing.nodeNodeBetweenLayers': String(Math.max(across ? 64 : 52, fit)),
    'elk.spacing.nodeNode': across ? '30' : '40',
    'elk.spacing.edgeNode': '22',
    'elk.spacing.edgeEdge': '14',
    'elk.layered.spacing.edgeNodeBetweenLayers': '22',
    'elk.layered.spacing.edgeEdgeBetweenLayers': '12',
  }
}

/** Every cluster and node id under each cluster, for spotting edges that cross its border. */
function members(model: FlowModel): Map<string, Set<string>> {
  const parentOf = new Map<string, string | null>()
  for (const c of model.clusters) parentOf.set(`c:${c.id}`, c.parent)
  for (const node of model.nodes) parentOf.set(`n:${node.id}`, node.parent)
  const out = new Map<string, Set<string>>()
  for (const c of model.clusters) out.set(c.id, new Set())
  for (const key of parentOf.keys())
    for (let p = parentOf.get(key); p; p = parentOf.get(`c:${p}`) ?? null) out.get(p)?.add(key)
  return out
}

function endpoint({ model, id }: { model: FlowModel; id: string }): string | null {
  if (model.nodes.some((node) => node.id === id)) return `n:${id}`
  if (model.clusters.some((c) => c.id === id)) return `c:${id}`
  return null
}

function buildEdges({
  model,
  inside,
  plan,
  back,
}: {
  model: FlowModel
  inside: Map<string, Set<string>>
  plan: PortPlan
  back: Set<number>
}): ElkExtendedEdge[] {
  const out: ElkExtendedEdge[] = []
  model.edges.forEach((edge, i) => {
    const source = endpoint({ model, id: edge.from })
    const target = endpoint({ model, id: edge.to })
    if (!source || !target) return
    const nested =
      inside.get(edge.from)?.has(target) === true || inside.get(edge.to)?.has(source) === true
    if (nested) return
    const from = plan.source.get(i) ?? source
    const to = plan.target.get(i) ?? target
    out.push({
      id: `e${i}`,
      sources: [back.has(i) ? to : from],
      targets: [back.has(i) ? from : to],
    })
  })
  return out
}

/** Edges whose two ends lie on opposite sides of the cluster's border. */
function crossesBorder({
  edges,
  inner,
}: {
  edges: ElkExtendedEdge[]
  inner: Set<string>
}): boolean {
  return edges.some((e) => inner.has(ownerOf(e.sources[0])) !== inner.has(ownerOf(e.targets[0])))
}

/**
 * A cluster's padding and minimum size. A concurrent region has no title, so it keeps a thin
 * margin; a composite split into regions lays them side by side in one layer.
 */
function clusterBox({
  c,
  model,
  titles,
}: {
  c: FlowCluster
  model: FlowModel
  titles: Map<string, number>
}): Record<string, string> {
  if (c.region) {
    const composite = model.clusters.find((p) => p.id === c.parent)
    return {
      'elk.padding': `[top=${REGION_PAD},left=${REGION_PAD},bottom=${REGION_PAD},right=${REGION_PAD}]`,
      'elk.direction': ELK_DIRECTION[composite?.direction ?? model.direction],
    }
  }
  const split = model.clusters.some((r) => r.region && r.parent === c.id)
  return {
    'elk.padding': `[top=${CLUSTER_PAD.top},left=${CLUSTER_PAD.side},bottom=${CLUSTER_PAD.bottom},right=${CLUSTER_PAD.side}]`,
    'elk.nodeSize.constraints': 'MINIMUM_SIZE',
    'elk.nodeSize.minimum': `(${Math.ceil(titles.get(c.id) ?? 80)}, 60)`,
    ...(split
      ? {
          'elk.separateConnectedComponents': 'false',
          'elk.spacing.nodeNode': '28',
          'elk.layered.considerModelOrder.crossingCounterNodeInfluence': '0.001',
        }
      : {}),
  }
}

function buildTree({
  model,
  sizes,
  titles,
  edges,
  inside,
  plan,
  span,
}: {
  model: FlowModel
  sizes: Map<string, Size>
  titles: Map<string, number>
  edges: ElkExtendedEdge[]
  inside: Map<string, Set<string>>
  plan: PortPlan
  span: LabelSpan
}): ElkNode[] {
  const childrenOf = (parent: string | null): ElkNode[] =>
    [
      ...model.clusters
        .filter((c) => c.parent === parent)
        .map((c) => {
          const own: Record<string, string> = {
            ...spacing({ direction: c.direction ?? model.direction, span }),
            ...clusterBox({ c, model, titles }),
          }
          const inner = inside.get(c.id) ?? new Set<string>()
          const sealed = !crossesBorder({ edges, inner })
          if (c.direction && c.direction !== model.direction && sealed) {
            own['elk.hierarchyHandling'] = 'SEPARATE_CHILDREN'
            own['elk.direction'] = ELK_DIRECTION[c.direction]
          }
          if (sealed && own['elk.separateConnectedComponents']) {
            own['elk.hierarchyHandling'] = 'SEPARATE_CHILDREN'
            own['elk.direction'] = ELK_DIRECTION[c.direction ?? model.direction]
            own['elk.layered.crossingMinimization.forceNodeModelOrder'] = 'true'
          }
          return { id: `c:${c.id}`, layoutOptions: own, children: childrenOf(c.id) }
        }),
      ...model.nodes
        .filter((node) => node.parent === parent)
        .map((node) => {
          const size = sizes.get(node.id) ?? { w: 80, h: 40 }
          const ports = plan.ports.get(node.id)
          if (!ports) return { id: `n:${node.id}`, width: size.w, height: size.h }
          return {
            id: `n:${node.id}`,
            width: size.w,
            height: size.h,
            ports,
            layoutOptions: { 'elk.portConstraints': 'FIXED_POS' },
          }
        }),
    ].sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0))
  const rank = firstMentions({ model, inside })
  return childrenOf(null)
}

/** Each ELK node's place in the source: a cluster ranks with its earliest member. */
function firstMentions({
  model,
  inside,
}: {
  model: FlowModel
  inside: Map<string, Set<string>>
}): Map<string, number> {
  const rank = new Map<string, number>(model.nodes.map((node, i) => [`n:${node.id}`, i]))
  for (const c of model.clusters) {
    const ranks = [...(inside.get(c.id) ?? [])].map((key) => rank.get(key) ?? Infinity)
    rank.set(`c:${c.id}`, Math.min(model.nodes.length, ...ranks))
  }
  return rank
}

function sectionPoints(edge: ElkExtendedEdge): Point[] {
  const points: Point[] = []
  for (const s of edge.sections ?? []) {
    points.push(s.startPoint, ...(s.bendPoints ?? []), s.endPoint)
  }
  return points.map((p) => ({ x: p.x, y: p.y }))
}

function collect({ node, offset, layout }: { node: ElkNode; offset: Point; layout: Layout }): void {
  for (const child of node.children ?? []) {
    const box = {
      x: offset.x + (child.x ?? 0),
      y: offset.y + (child.y ?? 0),
      w: child.width ?? 0,
      h: child.height ?? 0,
    }
    if (child.id.startsWith('n:')) layout.nodes.set(child.id.slice(2), box)
    else {
      layout.clusters.set(child.id.slice(2), box)
      collect({ node: child, offset: { x: box.x, y: box.y }, layout })
    }
  }
}

/**
 * Edges that close a cycle, found by a depth-first walk in source order. Reversing these before
 * layout keeps the flow running the way the author wrote it: the first-mentioned node leads.
 */
export function backEdges(model: FlowModel): Set<number> {
  const out = new Map<string, { to: string; index: number }[]>()
  model.edges.forEach((edge, index) => {
    if (edge.from === edge.to) return
    const list = out.get(edge.from) ?? []
    list.push({ to: edge.to, index })
    out.set(edge.from, list)
  })
  const back = new Set<number>()
  const state = new Map<string, 'open' | 'done'>()
  const visit = (id: string): void => {
    state.set(id, 'open')
    for (const { to, index } of out.get(id) ?? []) {
      const seen = state.get(to)
      if (seen === 'open') back.add(index)
      else if (!seen) visit(to)
    }
    state.set(id, 'done')
  }
  const starts = [...model.nodes.map((node) => node.id), ...model.edges.map((e) => e.from)]
  const hasIncoming = new Set(model.edges.filter((e) => e.from !== e.to).map((e) => e.to))
  for (const id of starts) if (!state.has(id) && !hasIncoming.has(id)) visit(id)
  for (const id of starts) if (!state.has(id)) visit(id)
  return back
}

/** Lays the graph out with ELK's layered algorithm: compound clusters, orthogonal edges. */
export async function layoutGraph({
  model,
  sizes,
  labels,
  titles,
}: {
  model: FlowModel
  sizes: Map<string, Size>
  labels: (Size | null)[]
  titles: Map<string, number>
}): Promise<Layout> {
  const inside = members(model)
  const back = backEdges(model)
  const span = {
    w: Math.max(0, ...labels.map((l) => l?.w ?? 0)),
    h: Math.max(0, ...labels.map((l) => l?.h ?? 0)),
    twoWay: model.edges.some(
      (e, i) => labels[i] && model.edges.some((r) => r.from === e.to && r.to === e.from),
    ),
  }
  const build = (plan: PortPlan): ElkNode => {
    const edges = buildEdges({ model, inside, plan, back })
    return {
      id: 'root',
      layoutOptions: rootOptions({ direction: model.direction, span }),
      children: buildTree({ model, sizes, titles, edges, inside, plan, span }),
      edges,
    }
  }
  const plain: PortPlan = { ports: new Map(), source: new Map(), target: new Map() }
  const engine = await elk()
  const result = await engine
    .layout(build(planPorts({ model, sizes, skip: back })))
    .catch(() => engine.layout(build(plain)))
  const layout: Layout = {
    width: result.width ?? 0,
    height: result.height ?? 0,
    nodes: new Map(),
    clusters: new Map(),
    edges: [],
  }
  collect({ node: result, offset: { x: 0, y: 0 }, layout })
  for (const e of result.edges ?? []) {
    const index = Number(e.id.slice(1))
    const edge = model.edges[index]
    const points = sectionPoints(e)
    layout.edges.push({ edge, points: back.has(index) ? points.reverse() : points })
  }
  return layout
}
