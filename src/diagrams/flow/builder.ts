import type { Diagnostic } from '../../core/parse.ts'
import type {
  Direction,
  FlowCluster,
  FlowEdge,
  FlowModel,
  FlowNode,
  Shape,
  Style,
} from './model.ts'

/**
 * Collects nodes, edges and clusters while a parser walks the source, applying Mermaid's rules:
 * a node mentioned inside a subgraph belongs to the innermost one that mentions it, and `class`
 * and `style` statements may come before the things they style.
 */
export interface GraphBuilder {
  diagnostics: Diagnostic[]
  /** The cluster statements are currently inside, or null. */
  current(): FlowCluster | null
  touch(node: { id: string; label?: string; shape?: Shape }): FlowNode
  addClass(update: { id: string; names: string[] }): void
  addStyle(update: { id: string; style: Style }): void
  defineClass(update: { names: string[]; style: Style }): void
  edge(edge: FlowEdge): void
  open(cluster: { id: string; title: string }): FlowCluster
  close(line: number): void
  setDirection(direction: Direction): void
  /** Open clusters, so the parser can warn about a missing `end`. */
  depth(): number
  finish(kind: FlowModel['kind']): FlowModel
}

interface Pending {
  classes: { id: string; names: string[] }[]
  styles: { id: string; style: Style }[]
}

/** Drops nodes that only stood for a cluster and applies `class` and `style` statements. */
function settle({
  nodes,
  clusters,
  pending,
}: {
  nodes: Map<string, FlowNode>
  clusters: Map<string, FlowCluster>
  pending: Pending
}): void {
  for (const id of clusters.keys()) {
    const node = nodes.get(id)
    if (node && !node.declared) nodes.delete(id)
  }
  for (const { id, names } of pending.classes) {
    const target = nodes.get(id) ?? clusters.get(id)
    if (target) target.classes.push(...names)
  }
  for (const { id, style } of pending.styles) {
    const target = nodes.get(id) ?? clusters.get(id)
    if (target) target.style = { ...target.style, ...style }
  }
}

function within({
  clusters,
  inner,
  outer,
}: {
  clusters: Map<string, FlowCluster>
  inner: string
  outer: string
}): boolean {
  for (let c = clusters.get(inner); c; c = c.parent ? clusters.get(c.parent) : undefined)
    if (c.id === outer) return true
  return false
}

export function graphBuilder(direction: Direction): GraphBuilder {
  const nodes = new Map<string, FlowNode>()
  const clusters = new Map<string, FlowCluster>()
  const edges: FlowEdge[] = []
  const stack: FlowCluster[] = []
  const classDefs: Record<string, Style> = {}
  const pending: Pending = { classes: [], styles: [] }
  const diagnostics: Diagnostic[] = []
  let graphDirection = direction

  const claim = (node: FlowNode) => {
    const here = stack[stack.length - 1]
    if (!here || node.id === here.id) return
    if (node.parent === null || within({ clusters, inner: here.id, outer: node.parent }))
      node.parent = here.id
  }

  return {
    diagnostics,
    current() {
      return stack[stack.length - 1] ?? null
    },
    touch({ id, label, shape }) {
      let node = nodes.get(id)
      if (!node) {
        node = {
          id,
          label: id,
          shape: 'rect',
          classes: [],
          style: {},
          parent: null,
          declared: false,
        }
        nodes.set(id, node)
      }
      if (label !== undefined) node.label = label
      if (shape) node.shape = shape
      if (label !== undefined || shape) node.declared = true
      claim(node)
      return node
    },
    addClass(update) {
      pending.classes.push(update)
    },
    addStyle(update) {
      pending.styles.push(update)
    },
    defineClass({ names, style }) {
      for (const name of names) classDefs[name] = { ...classDefs[name], ...style }
    },
    edge(edge) {
      edges.push(edge)
    },
    open({ id, title }) {
      const parent = stack[stack.length - 1]?.id ?? null
      const existing = clusters.get(id)
      const cluster = existing ?? { id, title, parent, classes: [], style: {} }
      if (!existing) clusters.set(id, cluster)
      stack.push(cluster)
      return cluster
    },
    close(line) {
      if (!stack.pop())
        diagnostics.push({
          line,
          message: 'This `end` has no subgraph to close; remove it or add a `subgraph` above.',
          severity: 'warning',
        })
    },
    setDirection(value) {
      const here = stack[stack.length - 1]
      if (here) here.direction = value
      else graphDirection = value
    },
    depth() {
      return stack.length
    },
    finish(kind) {
      settle({ nodes, clusters, pending })
      return {
        kind,
        direction: graphDirection,
        nodes: [...nodes.values()],
        edges,
        clusters: [...clusters.values()],
        classDefs,
      }
    },
  }
}
