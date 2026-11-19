import {
  mix,
  OUTLINE,
  parseOklch,
  type Swatch,
  swatchFor,
  type Tokens,
  toned,
} from '../../theme/index.ts'
import type { FlowCluster, FlowModel, FlowNode, Shape, Style } from './model.ts'

/** The colors and line a node, cluster or edge is drawn with. */
export interface Paint {
  fill: string
  stroke: string
  ink: string
  width: number
  dash?: string
}

const TERMINALS = new Set<Shape>(['stadium', 'circle', 'doublecircle'])
const SOLID = new Set<Shape>(['start', 'end', 'fork'])

/** Whether a color has a hue worth keeping; pale tints like `#e0f7fa` count. */
function chromatic(color: string | undefined): boolean {
  if (!color) return false
  const parsed = parseOklch(color)
  return parsed !== null && parsed.c >= 0.02
}

function lightness(color: string): number {
  return parseOklch(color)?.l ?? 1
}

function strokeWidth(style: Style): number {
  const width = Number.parseFloat(style['stroke-width'] ?? '')
  return Number.isFinite(width) ? Math.min(4, Math.max(1, width * 0.75)) : OUTLINE.thin
}

function dashOf(style: Style): string | undefined {
  return style['stroke-dasharray'] ? '5 4' : undefined
}

/** A colored fill keeps its hue in the theme's tones; a deep fill stays deep, with light text. */
function filledPaint({ fill, tokens }: { fill: string; tokens: Tokens }): Omit<Paint, 'width'> {
  const parsed = parseOklch(fill)
  const sw = parsed ? toned({ tokens, hue: parsed.h }) : tokens.accent
  if (lightness(fill) < 0.62)
    return { fill: sw.strong, stroke: sw.strong, ink: tokens.dark ? tokens.bg : tokens.surface }
  return { fill: sw.soft, stroke: sw.stroke, ink: sw.ink }
}

/** A plain fill: a colored stroke outlines, a dark fill inverts, greys become neutral. */
function plainPaint({ style, tokens }: { style: Style; tokens: Tokens }): Omit<Paint, 'width'> {
  const { fill, stroke } = style
  if (stroke && chromatic(stroke)) {
    const sw = swatchFor({ tokens, color: stroke }) ?? tokens.accent
    return { fill: tokens.surface, stroke: sw.stroke, ink: tokens.fg }
  }
  if (fill && lightness(fill) < 0.45) return { fill: tokens.fg, stroke: tokens.fg, ink: tokens.bg }
  return { fill: tokens.sunken, stroke: tokens.muted, ink: tokens.fg }
}

/** A Mermaid `fill`/`stroke` style pulled into the theme, so authored colors harmonize. */
export function styledPaint({ style, tokens }: { style: Style; tokens: Tokens }): Paint | null {
  const { fill, stroke } = style
  if (!fill && !stroke) return null
  const colors =
    fill && chromatic(fill) ? filledPaint({ fill, tokens }) : plainPaint({ style, tokens })
  return { ...colors, width: strokeWidth(style), dash: dashOf(style) }
}

/** A node's own `class` and `style` styling, merged over `classDef default`. */
export function ownStyle({
  classes,
  style,
  model,
}: {
  classes: string[]
  style: Style
  model: FlowModel
}): Style {
  const merged: Style = { ...model.classDefs.default }
  for (const name of classes) Object.assign(merged, model.classDefs[name])
  return { ...merged, ...style }
}

function authoredSwatch({
  cluster,
  model,
  tokens,
}: {
  cluster: FlowCluster
  model: FlowModel
  tokens: Tokens
}): Swatch | null {
  const custom = ownStyle({ classes: cluster.classes, style: cluster.style, model })
  const color = custom.fill && chromatic(custom.fill) ? custom.fill : custom.stroke
  return color && chromatic(color) ? swatchFor({ tokens, color }) : null
}

/** One swatch per top-level cluster, in order; nested clusters share their ancestor's. */
export function clusterSwatches({
  model,
  tokens,
}: {
  model: FlowModel
  tokens: Tokens
}): Map<string, Swatch> {
  const out = new Map<string, Swatch>()
  const byId = new Map(model.clusters.map((c) => [c.id, c]))
  const offset = model.kind === 'state' ? 1 : 0
  model.clusters
    .filter((c) => !c.parent)
    .forEach((c, index) => {
      const given = authoredSwatch({ cluster: c, model, tokens })
      out.set(c.id, given ?? tokens.palette[(index + offset) % tokens.palette.length])
    })
  const resolve = (c: FlowCluster): Swatch => {
    const own = out.get(c.id) ?? authoredSwatch({ cluster: c, model, tokens })
    if (own) return own
    const parent = c.parent ? byId.get(c.parent) : undefined
    return parent ? resolve(parent) : tokens.accent
  }
  for (const c of model.clusters) out.set(c.id, resolve(c))
  return out
}

/** Nesting depth of a cluster, 0 at the top level. Concurrent regions don't add a level. */
export function depthOf({ model, id }: { model: FlowModel; id: string }): number {
  let depth = 0
  let c = model.clusters.find((x) => x.id === id)
  while (c?.parent) {
    const parent: string = c.parent
    c = model.clusters.find((x) => x.id === parent)
    if (!c?.region) depth++
  }
  return depth
}

export function clusterPaint({
  sw,
  depth,
  tokens,
}: {
  sw: Swatch
  depth: number
  tokens: Tokens
}): Paint {
  const fill = depth
    ? mix({ from: sw.fill, to: sw.soft, amount: Math.min(0.75, 0.4 * depth) })
    : sw.fill
  return {
    fill,
    stroke: mix({ from: fill, to: sw.stroke, amount: tokens.dark ? 0.35 : 0.3 }),
    ink: sw.ink,
    width: 1,
  }
}

/** Colors for nodes inside a cluster: white cards outlined in the cluster's color. */
function groupedPaint({ node, sw, tokens }: { node: FlowNode; sw: Swatch; tokens: Tokens }): Paint {
  if (node.shape === 'diamond' || node.shape === 'choice' || TERMINALS.has(node.shape))
    return { fill: sw.soft, stroke: sw.stroke, ink: sw.ink, width: OUTLINE.thin }
  return { fill: tokens.surface, stroke: sw.stroke, ink: tokens.fg, width: OUTLINE.thin }
}

/** Default colors by role: decisions in caution, terminals in accent, the rest neutral. */
function rolePaint({
  node,
  model,
  tokens,
}: {
  node: FlowNode
  model: FlowModel
  tokens: Tokens
}): Paint {
  const c = tokens.semantic.caution
  const a = tokens.accent
  if (SOLID.has(node.shape))
    return { fill: tokens.fg, stroke: tokens.fg, ink: tokens.bg, width: 1.5 }
  if (node.shape === 'note')
    return {
      fill: c.fill,
      stroke: mix({ from: c.fill, to: c.stroke, amount: 0.6 }),
      ink: c.ink,
      width: 1,
    }
  if (node.shape === 'diamond' || node.shape === 'choice')
    return { fill: c.fill, stroke: c.stroke, ink: c.ink, width: OUTLINE.thin }
  if (TERMINALS.has(node.shape) || model.kind === 'state')
    return { fill: a.fill, stroke: a.stroke, ink: a.ink, width: OUTLINE.thin }
  return {
    fill: tokens.surface,
    stroke: mix({ from: tokens.faint, to: tokens.muted, amount: 0.35 }),
    ink: tokens.fg,
    width: OUTLINE.thin,
  }
}

export function nodePaint({
  node,
  model,
  tokens,
  swatches,
}: {
  node: FlowNode
  model: FlowModel
  tokens: Tokens
  swatches: Map<string, Swatch>
}): Paint {
  const style = ownStyle({ classes: node.classes, style: node.style, model })
  const custom = styledPaint({ style, tokens })
  if (custom) return custom
  const sw = node.parent ? swatches.get(node.parent) : undefined
  if (sw && !SOLID.has(node.shape) && node.shape !== 'note')
    return groupedPaint({ node, sw, tokens })
  return rolePaint({ node, model, tokens })
}
