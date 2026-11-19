import { arrowHead, type Point } from '../../core/geometry.ts'
import { target, uniqueIds } from '../../core/hooks.ts'
import { g, h, n, text } from '../../core/svg.ts'
import { balance, type TextKit, type TextStyle } from '../../core/text.ts'
import type { Context, Drawing } from '../../core/types.ts'
import {
  corner,
  mix,
  OUTLINE,
  type Swatch,
  swatchFor,
  type Tokens,
  WEIGHT,
} from '../../theme/index.ts'
import { CLUSTER_PAD, type Layout, layoutGraph, type PlacedEdge, type Size } from './layout.ts'
import type { FlowEdge, FlowModel, FlowNode, Head } from './model.ts'
import { clusterPaint, clusterSwatches, depthOf, nodePaint } from './paint.ts'
import { curve, endAngle, enter, pointAlong, simplify, trimEnd } from './route.ts'
import { type Box, labelCenter, outline, shapePaths, shapeSize } from './shapes.ts'
import { straightenEdges } from './straighten.ts'

const LABEL = { size: 14, weight: 500 }
const EDGE_LABEL = { size: 12.5, weight: 500 }
const TITLE = { size: 13, weight: WEIGHT.heading }
const NO_TEXT = new Set(['start', 'end', 'fork', 'choice'])

/** Keeps the author's line breaks and balances each line that runs long. */
function wrapLines({
  kit,
  text: label,
  style,
  max,
}: {
  kit: TextKit
  text: string
  style: TextStyle
  max: number
}): string[] {
  return label.split('\n').flatMap((line) => balance({ kit, text: line, style, max }))
}

interface Measured {
  lines: string[]
  size: Size
}

function measureNode({
  node,
  model,
  ctx,
}: {
  node: FlowNode
  model: FlowModel
  ctx: Context
}): Measured {
  const kit = ctx.text
  if (NO_TEXT.has(node.shape)) {
    const size = shapeSize({ shape: node.shape, tw: 0, th: 0, direction: model.direction })
    return { lines: [], size }
  }
  const max = node.shape === 'diamond' ? 150 : 210
  const lines = node.label ? wrapLines({ kit, text: node.label, style: LABEL, max }) : []
  const tw = Math.max(0, ...lines.map((l) => kit.width(l, LABEL)))
  const th = lines.length * kit.lineHeight(LABEL)
  return { lines, size: shapeSize({ shape: node.shape, tw, th, direction: model.direction }) }
}

function measureLabel({ edge, ctx }: { edge: FlowEdge; ctx: Context }): Measured | null {
  if (!edge.label) return null
  const kit = ctx.text
  const lines = wrapLines({ kit, text: edge.label, style: EDGE_LABEL, max: 150 })
  const tw = Math.max(...lines.map((l) => kit.width(l, EDGE_LABEL)))
  return { lines, size: { w: tw + 14, h: lines.length * kit.lineHeight(EDGE_LABEL) + 7 } }
}

function edgeColor({ edge, tokens }: { edge: FlowEdge; tokens: Tokens }): string {
  const custom = edge.style.stroke ? swatchFor({ tokens, color: edge.style.stroke }) : null
  if (custom) return custom.stroke
  if (edge.tether) return tokens.faint
  if (edge.line === 'thick') return tokens.muted
  return mix({ from: tokens.faint, to: tokens.muted, amount: 0.45 })
}

/** Clips an end of the route to the real outline of the node it meets (a diamond, a circle). */
function clipEnd({
  points,
  box,
  node,
}: {
  points: Point[]
  box: Box | undefined
  node: FlowNode | undefined
}): Point[] {
  if (!box || !node || points.length < 2) return points
  const polygon = outline({ shape: node.shape, box })
  const last = points[points.length - 1]
  const prev = points[points.length - 2]
  const hit = enter({ from: prev, to: last, polygon })
  if (!hit) return points
  return [...points.slice(0, -1), hit]
}

function headMark({
  head,
  points,
  color,
  width,
  tokens,
}: {
  head: Head
  points: Point[]
  color: string
  width: number
  tokens: Tokens
}): { mark: string; trim: number } {
  const tip = points[points.length - 1]
  const angle = endAngle(points)
  const ux = Math.cos(angle)
  const uy = Math.sin(angle)
  if (head === 'arrow') {
    const size = 9 + width * 0.8
    return {
      mark: h('path', { d: arrowHead({ tip, angle, size }), fill: color }),
      trim: size * 0.55,
    }
  }
  if (head === 'circle') {
    const r = 4
    const c = { x: tip.x - ux * r, y: tip.y - uy * r }
    return {
      mark: h('circle', {
        cx: c.x,
        cy: c.y,
        r,
        fill: tokens.bg,
        stroke: color,
        'stroke-width': 1.6,
      }),
      trim: r * 2,
    }
  }
  if (head === 'cross') {
    const s = 4.5
    const c = { x: tip.x - ux * 7, y: tip.y - uy * 7 }
    const d = `M${n(c.x - s)} ${n(c.y - s)}L${n(c.x + s)} ${n(c.y + s)}M${n(c.x - s)} ${n(c.y + s)}L${n(c.x + s)} ${n(c.y - s)}`
    return {
      mark: h('path', { d, stroke: color, 'stroke-width': 1.8, 'stroke-linecap': 'round' }),
      trim: 0,
    }
  }
  return { mark: '', trim: 0 }
}

interface Scene {
  model: FlowModel
  layout: Layout
  ctx: Context
  nodes: Map<string, FlowNode>
  swatches: Map<string, Swatch>
  /** Each edge's id for the host app: its own (`e1@-->`), or `A->B` with a count for repeats. */
  edgeIds: Map<FlowEdge, string>
}

function edgeIds(edges: FlowEdge[]): Map<FlowEdge, string> {
  const next = uniqueIds()
  return new Map(edges.map((e) => [e, e.id ?? next(`${e.from}->${e.to}`)]))
}

/** An edge as drawn, and its line as a polyline (sampled along curves) for its label. */
interface DrawnEdge {
  svg: string
  line: Point[]
}

function drawEdge({ placed, scene }: { placed: PlacedEdge; scene: Scene }): DrawnEdge {
  const { edge } = placed
  const { tokens } = scene.ctx
  if (edge.line === 'invisible' || placed.points.length < 2) return { svg: '', line: placed.points }
  const color = edgeColor({ edge, tokens })
  const width = edge.line === 'thick' ? 2.6 : 1.5
  let points = simplify(placed.points)
  points = clipEnd({ points, box: scene.layout.nodes.get(edge.to), node: scene.nodes.get(edge.to) })
  points = clipEnd({
    points: points.slice().reverse(),
    box: scene.layout.nodes.get(edge.from),
    node: scene.nodes.get(edge.from),
  }).reverse()
  const end = headMark({ head: edge.head, points, color, width, tokens })
  points = trimEnd({ points, by: end.trim })
  const start = headMark({
    head: edge.tail,
    points: points.slice().reverse(),
    color,
    width,
    tokens,
  })
  points = trimEnd({ points: points.slice().reverse(), by: start.trim }).reverse()
  const dash = edge.line === 'dotted' || edge.tether ? '1 5' : undefined
  const { d, line } = curve(points)
  const svg = g(
    {
      ...target({ id: scene.edgeIds.get(edge) ?? '', kind: 'edge', tint: color }),
      class: 'edge',
    },
    h('path', {
      d,
      fill: 'none',
      stroke: color,
      'stroke-width': edge.line === 'dotted' ? 2 : width,
      'stroke-dasharray': dash,
      'stroke-linecap': dash ? 'round' : undefined,
      'stroke-linejoin': 'round',
    }),
    end.mark,
    start.mark,
  )
  return { svg, line }
}

function overlapsAny({
  center,
  size,
  boxes,
}: {
  center: Point
  size: Size
  boxes: Box[]
}): boolean {
  const pad = 3
  return boxes.some(
    (b) =>
      Math.abs(center.x - (b.x + b.w / 2)) < (b.w + size.w) / 2 + pad &&
      Math.abs(center.y - (b.y + b.h / 2)) < (b.h + size.h) / 2 + pad,
  )
}

/** Where along its line a label tries to sit, in order: the middle first, then either side. */
const LABEL_STOPS = [0.5, 0.4, 0.6, 0.3, 0.7]

function boxAt({ center, size }: { center: Point; size: Size }): Box {
  return { x: center.x - size.w / 2, y: center.y - size.h / 2, w: size.w, h: size.h }
}

/** Spots just beside a line's middle: below, above, right, then left of it. */
function besideSpots({ line, size }: { line: Point[]; size: Size }): Point[] {
  const mid = pointAlong({ points: line, fraction: 0.5 })
  const dy = size.h / 2 + 6
  const dx = size.w / 2 + 6
  return [
    { x: mid.x, y: mid.y + dy },
    { x: mid.x, y: mid.y - dy },
    { x: mid.x + dx, y: mid.y },
    { x: mid.x - dx, y: mid.y },
  ]
}

interface LabelSlot {
  line: Point[]
  size: Size
}

/**
 * Two labels that both had to leave their lines, as on the close parallel lines of a two-way
 * link: the first pair of spots beside each line that clear everything and each other.
 */
function besidePair({
  a,
  b,
  others,
}: {
  a: LabelSlot
  b: LabelSlot
  others: Box[]
}): [Box, Box] | null {
  for (const ca of besideSpots(a)) {
    if (overlapsAny({ center: ca, size: a.size, boxes: others })) continue
    const boxA = boxAt({ center: ca, size: a.size })
    const cb = besideSpots(b).find((c) => !overlapsAny({ center: c, size: b.size, boxes: [...others, boxA] }))
    if (cb) return [boxA, boxAt({ center: cb, size: b.size })]
  }
  return null
}

/**
 * Where each edge label goes: on its line as drawn, at the middle, or the nearest stop either
 * side that clears every node and the labels already placed; else just beside the line's middle.
 * Where none of those clear, the label it runs into and it both move beside their lines; failing
 * that, it stays in the middle. Labels may reach past the layout, which grows to fit (see
 * `labelMargins`).
 */
function placeLabels({ slots, nodes }: { slots: (LabelSlot | null)[]; nodes: Box[] }): (Box | null)[] {
  const placed: (Box | null)[] = slots.map(() => null)
  const others = (skip: number) => [...nodes, ...placed.filter((b, j): b is Box => !!b && j !== skip)]
  slots.forEach((slot, i) => {
    if (!slot || slot.line.length < 2) return
    const { line, size } = slot
    const spots = [...LABEL_STOPS.map((fraction) => pointAlong({ points: line, fraction })), ...besideSpots(slot)]
    const free = spots.find((center) => !overlapsAny({ center, size, boxes: others(-1) }))
    if (free) return void (placed[i] = boxAt({ center: free, size }))
    const mid = boxAt({ center: spots[0], size })
    placed[i] = mid
    const j = placed.findIndex((b, k) => k !== i && b && overlapsAny({ center: centerOf(mid), size, boxes: [b] }))
    const other = j >= 0 ? slots[j] : null
    const pair = other && besidePair({ a: other, b: slot, others: others(j).filter((b) => b !== mid) })
    if (pair) [placed[j], placed[i]] = pair
  })
  return placed
}

function centerOf(box: Box): Point {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 }
}

/** How far the placed labels reach past each side of the layout, with a little air. */
function labelMargins({ labels, layout }: { labels: Box[]; layout: Layout }): {
  left: number
  top: number
  right: number
  bottom: number
} {
  const air = 8
  return {
    left: Math.max(0, ...labels.map((b) => air - b.x)),
    top: Math.max(0, ...labels.map((b) => air - b.y)),
    right: Math.max(0, ...labels.map((b) => b.x + b.w + air - layout.width)),
    bottom: Math.max(0, ...labels.map((b) => b.y + b.h + air - layout.height)),
  }
}

function drawEdgeLabel({
  placed,
  box,
  scene,
  measured,
}: {
  placed: PlacedEdge
  box: Box | null
  scene: Scene
  measured: Measured | null
}): string {
  if (!measured || !box) return ''
  const { tokens, text: kit } = scene.ctx
  const { x: cx, y: cy } = centerOf(box)
  return g(
    {
      ...target({
        id: scene.edgeIds.get(placed.edge) ?? '',
        kind: 'edge',
        tint: edgeColor({ edge: placed.edge, tokens }),
      }),
      class: 'edge-label',
    },
    h('rect', {
      x: cx - measured.size.w / 2,
      y: cy - measured.size.h / 2,
      width: measured.size.w,
      height: measured.size.h,
      rx: corner({ tokens, r: Math.min(9, measured.size.h / 2) }),
      fill: tokens.bg,
      stroke: tokens.border,
      'stroke-width': 1,
    }),
    text({
      x: cx,
      y: cy,
      lines: measured.lines,
      ...EDGE_LABEL,
      fill: tokens.muted,
      lineHeight: kit.lineHeight(EDGE_LABEL),
      shift: kit.baselineShift(EDGE_LABEL),
    }),
  )
}

function drawNode({
  node,
  scene,
  measured,
}: {
  node: FlowNode
  scene: Scene
  measured: Measured
}): string {
  const box = scene.layout.nodes.get(node.id)
  if (!box) return ''
  const { tokens, text: kit } = scene.ctx
  const paint = nodePaint({ node, model: scene.model, tokens, swatches: scene.swatches })
  const paths = shapePaths({ shape: node.shape, box, tokens })
  const center = labelCenter({ shape: node.shape, box })
  const detailColor = node.shape === 'end' ? tokens.bg : paint.stroke
  const ring = node.shape === 'end'
  return g(
    { ...target({ id: node.id, kind: 'node', tint: paint.stroke }), class: 'node' },
    h('path', {
      d: paths.body,
      fill: ring ? tokens.bg : paint.fill,
      stroke: paint.stroke,
      'stroke-width': ring ? OUTLINE.strong : paint.width,
      'stroke-dasharray': paint.dash,
      'stroke-linejoin': 'round',
      filter: ring || NO_TEXT.has(node.shape) ? undefined : 'url(#mm-shadow)',
    }),
    paths.detail
      ? h('path', {
          d: paths.detail,
          fill: ring ? paint.fill : 'none',
          stroke: ring ? 'none' : detailColor,
          'stroke-width': paint.width,
        })
      : '',
    text({
      x: center.x,
      y: center.y,
      lines: measured.lines,
      ...LABEL,
      fill: paint.ink,
      lineHeight: kit.lineHeight(LABEL),
      shift: kit.baselineShift(LABEL),
    }),
  )
}

function drawClusters(scene: Scene): string {
  const { model, layout, ctx } = scene
  const { tokens, text: kit } = ctx
  const { swatches } = scene
  return model.clusters
    .map((c) => ({ c, depth: depthOf({ model, id: c.id }) }))
    .sort((a, b) => a.depth - b.depth)
    .map(({ c, depth }) => {
      const box = layout.clusters.get(c.id)
      const sw = swatches.get(c.id)
      if (!box || !sw) return ''
      if (c.region) return ''
      const paint = clusterPaint({ sw, depth, tokens })
      return g(
        { ...target({ id: c.id, kind: 'cluster', tint: paint.stroke }), class: 'cluster' },
        h('rect', {
          x: box.x,
          y: box.y,
          width: box.w,
          height: box.h,
          rx: corner({ tokens, r: 12 }),
          fill: paint.fill,
          stroke: paint.stroke,
          'stroke-width': paint.width,
        }),
        c.title &&
          text({
            x: box.x + 16,
            y: box.y + 25,
            lines: [c.title],
            ...TITLE,
            fill: paint.ink,
            anchor: 'start',
            valign: 'top',
            lineHeight: kit.lineHeight(TITLE),
            shift: kit.baselineShift(TITLE),
          }),
      )
    })
    .join('')
}

/**
 * A dashed line between each pair of neighbouring concurrent regions, across the composite:
 * upright when the regions sit side by side, level when they're stacked.
 */
function drawDividers(scene: Scene): string {
  const { model, layout, ctx, swatches } = scene
  return model.clusters
    .filter((c) => !c.region && model.clusters.some((r) => r.region && r.parent === c.id))
    .flatMap((c) => {
      const outer = layout.clusters.get(c.id)
      const regions = model.clusters
        .filter((r) => r.region && r.parent === c.id)
        .flatMap((r) => layout.clusters.get(r.id) ?? [])
      const sw = swatches.get(c.id)
      if (!outer || !sw || regions.length < 2) return []
      const byY = [...regions].sort((a, b) => a.y - b.y)
      const across = !byY.slice(1).every((next, i) => next.y >= byY[i].y + byY[i].h - 1)
      const sorted = across ? [...regions].sort((a, b) => a.x - b.x) : byY
      return sorted.slice(1).map((next, i) => {
        const prev = sorted[i]
        const d = across
          ? `M${n((prev.x + prev.w + next.x) / 2)} ${n(outer.y + CLUSTER_PAD.top - 8)}V${n(outer.y + outer.h - 8)}`
          : `M${n(outer.x + 10)} ${n((prev.y + prev.h + next.y) / 2)}H${n(outer.x + outer.w - 10)}`
        return h('path', {
          d,
          fill: 'none',
          stroke: clusterPaint({ sw, depth: depthOf({ model, id: c.id }), tokens: ctx.tokens })
            .stroke,
          'stroke-width': 1.4,
          'stroke-dasharray': '6 5',
        })
      })
    })
    .join('')
}

/** Lays out and draws a flow model: clusters under edges under nodes, edge labels on top. */
export async function renderGraph(model: FlowModel, ctx: Context): Promise<Drawing> {
  const { tokens, text: kit } = ctx
  const measured = new Map(model.nodes.map((node) => [node.id, measureNode({ node, model, ctx })]))
  const labels = model.edges.map((edge) => measureLabel({ edge, ctx }))
  const titles = new Map(
    model.clusters.map((c) => [c.id, kit.width(c.title, TITLE) + CLUSTER_PAD.side * 2 + 8]),
  )
  const sizes = new Map([...measured].map(([id, m]) => [id, m.size]))
  const layout = await layoutGraph({
    model,
    sizes,
    labels: labels.map((l) => l?.size ?? null),
    titles,
  })
  const scene: Scene = {
    model,
    layout,
    ctx,
    swatches: clusterSwatches({ model, tokens }),
    nodes: new Map(model.nodes.map((node) => [node.id, node])),
    edgeIds: edgeIds(model.edges),
  }
  const title = ctx.options.title ?? ''
  const top = title ? 44 : 0
  const edges = straightenEdges(layout)
  const drawn = edges.map((placed) => drawEdge({ placed, scene }))
  const measuredLabels = edges.map((placed) => labels[model.edges.indexOf(placed.edge)])
  const spots = placeLabels({
    slots: measuredLabels.map((m, i) => (m ? { line: drawn[i].line, size: m.size } : null)),
    nodes: [...layout.nodes.values()],
  })
  const body = [
    drawClusters(scene),
    drawDividers(scene),
    ...drawn.map((e) => e.svg),
    ...model.nodes.map((node) =>
      drawNode({
        node,
        scene,
        measured: measured.get(node.id) ?? { lines: [], size: { w: 0, h: 0 } },
      }),
    ),
    ...edges.map((placed, i) =>
      drawEdgeLabel({ placed, box: spots[i], scene, measured: measuredLabels[i] }),
    ),
  ].join('')
  const margin = labelMargins({ labels: spots.filter((b): b is Box => !!b), layout })
  const width = layout.width + margin.left + margin.right
  const heading = title
    ? text({
        x: width / 2,
        y: 36,
        lines: [title],
        size: 20,
        weight: WEIGHT.title,
        fill: tokens.fg,
        lineHeight: kit.lineHeight({ size: 20 }),
        shift: kit.baselineShift({ size: 20 }),
      })
    : ''
  return {
    width: Math.max(width, title ? kit.width(title, { size: 20, weight: WEIGHT.title }) + 48 : 0),
    height: layout.height + top + margin.top + margin.bottom,
    body: heading + g({ x: margin.left, y: top + margin.top }, body),
    title: title || undefined,
  }
}
