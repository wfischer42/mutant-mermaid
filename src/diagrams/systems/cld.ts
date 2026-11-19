import { arrowHead } from '../../core/geometry.ts'
import { target } from '../../core/hooks.ts'
import { span } from '../../core/profile.ts'
import { g, h, n, text } from '../../core/svg.ts'
import { balance } from '../../core/text.ts'
import type { Diagnostic } from '../../core/parse.ts'
import type { Context, Drawing } from '../../core/types.ts'
import { toned } from '../../theme/index.ts'
import { tangles } from './cld-check.ts'
import { buildEdges, type Edge, type LoopView } from './cld-edges.ts'
import { dotBox, type LayoutNode, layoutCld, type Ring } from './cld-layout.ts'
import { type Obstacles, placeLabels, placeMarkers, placeSigns } from './cld-spots.ts'
import { chooseLoops, findCycles } from './cycles.ts'
import { curveHeading, curvePath, curvePoint } from './link-arc.ts'
import { drawBadge, drawDelay, drawSign, loopSwatch } from './marks.ts'
import { type Link, linkIds, type NamedLoop, type SystemsModel } from './model.ts'
import { drawTrend, type Trend } from './trend.ts'
import { type Box, bounds, boxAt, centroid, inflate, signedArea } from './vec.ts'

const LABEL = 14.5
const PAD_X = 10
const PAD_Y = 5
const WRAP = 132
const DOT = 12
const WEIGHT = 500

/**
 * The loops a causal loop diagram labels, with diagnostics about declared ones. Links without a
 * polarity count as +.
 */
export function analyse(model: SystemsModel) {
  const links = model.links.map((l) => ({ ...l, polarity: l.polarity === '?' ? '+' : l.polarity }))
  const cycles = findCycles({ nodes: model.variables, links })
  const { loops, diagnostics } = chooseLoops({ cycles, links, decls: model.loops })
  return { links, cycles, loops, diagnostics: [...diagnostics, ...crowded({ model, loops })] }
}

/**
 * Most loops one diagram holds before it reads as a tangle; past this, split the story. Set from a
 * sweep of generated diagrams: up to 4 loops nearly all draw cleanly, 5–6 depend on how the loops
 * share variables, and from 7 almost none do.
 */
const MAX_LOOPS = 6
/** Most loops through one variable: more, and its links pile up round its dot. */
const MAX_THROUGH = 4
/** From the same sweep: past 12 variables or 15 links, fewer than one diagram in five drew cleanly. */
const MAX_VARIABLES = 12
const MAX_LINKS = 15

/** A warning when the diagram holds more than a reader can follow, saying how to split it. */
function crowded({ model, loops }: { model: SystemsModel; loops: NamedLoop[] }): Diagnostic[] {
  const through = (id: string) => loops.filter((l) => l.cycle.nodes.includes(id)).length
  const hub = [...model.variables].sort((a, b) => through(b) - through(a))[0]
  const problems = [
    loops.length > MAX_LOOPS && `${loops.length} loops (keep to ${MAX_LOOPS} or fewer)`,
    hub && through(hub) > MAX_THROUGH && `${through(hub)} loops through "${hub}" (keep to ${MAX_THROUGH})`,
    model.variables.length > MAX_VARIABLES &&
      `${model.variables.length} variables (keep to ${MAX_VARIABLES})`,
    model.links.length > MAX_LINKS && `${model.links.length} links (keep to ${MAX_LINKS})`,
  ].filter(Boolean)
  if (!problems.length) return []
  return [
    {
      line: 1,
      severity: 'warning',
      message: `This diagram has ${problems.join(', ')}, so it will be hard to read. Split it into several diagrams, one per story, with a few loops each; repeat a shared variable in each diagram it belongs to.`,
    },
  ]
}

function labelLines({ label, ctx }: { label: string; ctx: Context }): string[] {
  return balance({ kit: ctx.text, text: label, style: { size: LABEL, weight: WEIGHT }, max: WRAP })
}

function textWidth({ label, ctx }: { label: string; ctx: Context }): number {
  const lines = labelLines({ label, ctx })
  return Math.max(...lines.map((line) => ctx.text.width(line, { size: LABEL, weight: WEIGHT })))
}

/** A dot that holds its variable's trend sketch. */
const TREND_DOT = 19

/** Each variable's room: its label, and a dot big enough for its trend when it has one. */
function measure({ model, ctx }: { model: SystemsModel; ctx: Context }): LayoutNode[] {
  const kit = ctx.text
  return model.variables.map((id) => {
    const lines = labelLines({ label: model.labels[id] ?? id, ctx })
    const label = {
      w: textWidth({ label: model.labels[id] ?? id, ctx }),
      h: lines.length * kit.lineHeight({ size: LABEL }),
    }
    const r = model.trends[id] ? TREND_DOT : DOT
    return { id, w: label.w + PAD_X * 2, h: label.h + PAD_Y * 2, x: 0, y: 0, r, label }
  })
}

/** Each loop's look: its kind's color, its middle and turn, and its trend. */
function loopViews({
  rings,
  loops,
  nodes,
  links,
  trends,
  ctx,
}: {
  rings: Ring[]
  loops: NamedLoop[]
  nodes: Map<string, LayoutNode>
  links: Link[]
  trends: Record<string, Trend>
  ctx: Context
}): LoopView[] {
  const rank = (ring: Ring) => loops.indexOf(ring.loop)
  const byImportance = [...rings].sort((left, right) => rank(left) - rank(right))
  return byImportance.map((ring) => {
    const points = ring.members.flatMap((id) => nodes.get(id) ?? [])
    return {
      ring,
      loop: ring.loop,
      swatch: loopSwatch({ tokens: ctx.tokens, kind: ring.loop.kind }),
      center: centroid(points),
      clockwise: signedArea(points) >= 0,
      trend: trends[ring.loop.tag] ?? loopTrend({ loop: ring.loop, links }),
    }
  })
}

/** What a loop does on its own: a reinforcing loop grows, a balancing one settles, or swings when delayed. */
export function loopTrend({ loop, links }: { loop: NamedLoop; links: Link[] }): Trend {
  if (loop.kind === 'R') return 'grow'
  return loop.cycle.links.some((i) => links[i]?.delay) ? 'oscillate' : 'approach'
}

/**
 * Pale dot fills for variable kinds, each hue far from those before it, so the first five or six
 * kinds stay apart. The loops' colors are near neutral, so kinds have the whole wheel.
 */
const KIND_HUES = [150, 300, 85, 210, 15, 260]

function kindFills({ model, ctx }: { model: SystemsModel; ctx: Context }): Map<string, string> {
  const fills = new Map<string, string>()
  model.kinds.forEach((kind, i) => {
    const { soft: fill } = toned({ tokens: ctx.tokens, hue: KIND_HUES[i % KIND_HUES.length] })
    fills.set(kind.name, fill)
    for (const id of kind.members) fills.set(`var:${id}`, fill)
  })
  return fills
}

const KEY_DOT = 7
const KEY_SIZE = 13
const KEY_ROW = 24

/** The legend's rows of kinds, each a filled dot and its name, wrapped to `width`. */
function legendRows({ model, width, ctx }: { model: SystemsModel; width: number; ctx: Context }) {
  const rows: { name: string; x: number }[][] = [[]]
  let x = 0
  for (const kind of model.kinds) {
    const w = KEY_DOT * 2 + 8 + ctx.text.width(kind.name, { size: KEY_SIZE, weight: WEIGHT }) + 22
    if (x && x + w > width) {
      rows.push([])
      x = 0
    }
    rows[rows.length - 1].push({ name: kind.name, x })
    x += w
  }
  return model.kinds.length ? rows : []
}

function drawLegend({
  rows,
  fills,
  x,
  y,
  ctx,
}: {
  rows: { name: string; x: number }[][]
  fills: Map<string, string>
  x: number
  y: number
  ctx: Context
}): string {
  const { tokens, text: kit } = ctx
  const items = rows.flatMap((row, r) =>
    row.map((item) => {
      const cy = y + r * KEY_ROW + KEY_ROW / 2
      return (
        h('circle', {
          cx: n(x + item.x + KEY_DOT),
          cy: n(cy),
          r: KEY_DOT,
          fill: fills.get(item.name) ?? tokens.surface,
          stroke: tokens.fg,
          'stroke-width': 1.25,
        }) +
        text({
          x: x + item.x + KEY_DOT * 2 + 8,
          y: cy,
          anchor: 'start',
          lines: [item.name],
          size: KEY_SIZE,
          weight: WEIGHT,
          fill: tokens.fg,
          lineHeight: kit.lineHeight({ size: KEY_SIZE }),
          shift: kit.baselineShift({ size: KEY_SIZE }),
        })
      )
    }),
  )
  return items.length ? h('g', { class: 'legend' }, ...items) : ''
}

/** Where a label's text anchors: its edge nearest the dot when it sits to one side. */
function labelAnchor({ node, box }: { node: LayoutNode; box: Box }) {
  if (box.x >= node.x) return { x: box.x, anchor: 'start' as const }
  if (box.x + box.w <= node.x) return { x: box.x + box.w, anchor: 'end' as const }
  return { x: box.x + box.w / 2, anchor: 'middle' as const }
}

/** A variable: a dot filled for its kind and holding its trend, with its label beside it. */
function drawNode({
  node,
  label,
  box,
  fill,
  trend,
  ctx,
}: {
  node: LayoutNode
  label: string
  box: Box
  fill?: string
  trend?: Trend
  ctx: Context
}): string {
  const { tokens, text: kit } = ctx
  const y = box.y + box.h / 2
  return h(
    'g',
    target({ id: node.id, kind: 'variable', tint: tokens.muted }),
    h('circle', {
      cx: n(node.x),
      cy: n(node.y),
      r: node.r,
      fill: fill ?? tokens.surface,
      stroke: tokens.fg,
      'stroke-width': 1.5,
    }),
    trend &&
      drawTrend({ trend, cx: node.x, cy: node.y, w: 22, h: 11, ink: tokens.fg, tokens, axes: false }),
    text({
      ...labelAnchor({ node, box }),
      y,
      lines: labelLines({ label, ctx }),
      size: LABEL,
      weight: WEIGHT,
      fill: tokens.fg,
      lineHeight: kit.lineHeight({ size: LABEL }),
      shift: kit.baselineShift({ size: LABEL }),
    }),
  )
}

/** A negative link is dotted: round caps on zero-length dashes, so the line reads apart from a + link. */
export const NEGATIVE_DOTS = '0 6'

function drawEdge({ edge, id, ctx }: { edge: Edge; id: string; ctx: Context }): string {
  const stroke = edge.color?.stroke ?? ctx.tokens.muted
  const strong = edge.color?.strong ?? ctx.tokens.fg
  const negative = edge.link.polarity === '-'
  const parts = [
    h('path', {
      d: curvePath({ curve: edge.curve, t0: edge.t0, t1: edge.t1 }),
      fill: 'none',
      stroke,
      'stroke-width': negative ? 2.6 : 2,
      'stroke-linecap': 'round',
      'stroke-dasharray': negative ? NEGATIVE_DOTS : undefined,
    }),
    h('path', { d: arrowHead({ tip: edge.tip, angle: edge.heading, size: 11 }), fill: strong }),
  ]
  if (edge.link.delay) {
    const t = (edge.t0 + edge.t1) / 2
    parts.push(
      drawDelay({
        at: curvePoint({ curve: edge.curve, t }),
        heading: curveHeading({ curve: edge.curve, t }),
        color: strong,
        tokens: ctx.tokens,
      }),
    )
  }
  return h('g', target({ id, kind: 'link', tint: stroke }), ...parts)
}

/** A centered diagram title, or nothing. */
export function drawTitle({
  title,
  width,
  ctx,
}: {
  title: string
  width: number
  ctx: Context
}): string {
  if (!title) return ''
  const size = 20
  return text({
    x: width / 2,
    y: 36,
    lines: [title],
    size,
    weight: 700,
    fill: ctx.tokens.fg,
    lineHeight: ctx.text.lineHeight({ size }),
    shift: ctx.text.baselineShift({ size }),
  })
}

/** Renders a causal loop diagram. */
export function renderCld(model: SystemsModel, ctx: Context): Drawing {
  const { tokens, text: kit } = ctx
  const { links, loops } = analyse(model)
  const { title } = model
  const nodes = measure({ model, ctx })
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const rings = span('cld:layout', () =>
    layoutCld({ nodes, links, loops, rng: ctx.rng.fork('cld') }),
  )
  const views = loopViews({ rings, loops, nodes: byId, links, trends: model.trends, ctx })
  const fills = kindFills({ model, ctx })
  const tint = !/^(off|none|false|no)$/i.test(ctx.options.tint ?? '')
  const edges = buildEdges({ links, nodes: byId, views, tint })
  const ids = linkIds(links)
  const obstacles: Obstacles = {
    boxes: nodes.map((node) => inflate({ box: dotBox(node), pad: 4 })),
    points: edges.flatMap((e) => e.samples),
  }
  const { labels, markers, signs } = span('cld:place', () => ({
    labels: placeLabels({ nodes, views, edges, obstacles }),
    markers: placeMarkers({ views, edges, obstacles, ctx }),
    signs: placeSigns({ edges, obstacles }),
  }))
  const frame = bounds({
    boxes: [
      ...nodes.map(dotBox),
      ...labels,
      ...markers.map((m) => m.box),
      ...signs.map((s) => boxAt({ center: s, w: 18, h: 18 })),
    ],
    points: edges.flatMap((e) => e.samples),
  })
  const margin = 28
  const top = title ? 64 : margin
  const titleW = title ? kit.width(title, { size: 20, weight: 700 }) : 0
  const width = Math.max(frame.w, titleW) + margin * 2
  const dx = margin - frame.x + (width - margin * 2 - frame.w) / 2
  const rows = legendRows({ model, width: width - margin * 2, ctx })
  const legendY = top + frame.h + margin / 2
  const look = tokens.look === 'sketch' ? { filter: 'url(#mm-ink)' } : {}
  const signMarks = edges.map((edge, i) =>
    edge.link.polarity === '?'
      ? ''
      : drawSign({
          polarity: edge.link.polarity,
          at: signs[i],
          color: edge.color?.strong ?? tokens.fg,
          tokens,
          kit,
        }),
  )
  const body =
    drawTitle({ title, width, ctx }) +
    g(
      { x: dx, y: top - frame.y },
      h(
        'g',
        { class: 'links', ...look },
        ...edges.map((edge) => drawEdge({ edge, id: ids[edge.index], ctx })),
      ),
      h(
        'g',
        { class: 'variables' },
        ...nodes.map((node, i) =>
          drawNode({
            node,
            label: model.labels[node.id] ?? node.id,
            box: labels[i],
            fill: fills.get(`var:${node.id}`),
            trend: model.trends[node.id],
            ctx,
          }),
        ),
      ),
      h(
        'g',
        { class: 'loops' },
        ...markers.map((m) => drawBadge({ badge: m.badge, at: m.at, kit, tokens })),
      ),
      h('g', { class: 'signs' }, ...signMarks),
    ) +
    drawLegend({ rows, fills, x: margin, y: legendY, ctx })
  const legendH = rows.length ? rows.length * KEY_ROW + margin / 2 : 0
  const diagnostics = crowded({ model, loops }).length ? [] : tangles({ edges, nodes })
  return { width, height: top + frame.h + margin + legendH, body, title, diagnostics }
}
