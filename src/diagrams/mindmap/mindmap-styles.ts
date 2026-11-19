import { cubicPath, type Point, roundedRect } from '../../core/geometry.ts'
import { h } from '../../core/svg.ts'
import type { Context } from '../../core/types.ts'
import { corner, OUTLINE, type Tokens } from '../../theme/index.ts'
import { elbow } from './canvas.ts'
import { label } from './label.ts'
import type { MindStyle } from './mindmap.ts'
import type { Item } from './mindmap-layout.ts'

/** What a style draws for the branches and nodes; the root and cross-links are shared. */
export interface StyledParts {
  branches: string[]
  nodes: string[]
  labels: string[]
}

interface Styling {
  root: Item
  everything: Item[]
  ctx: Context
}

const mid = (item: Item): number => item.y + item.h / 2

/** The edge facing the parent, at the label's middle. */
function inEdge(item: Item): Point {
  return { x: item.side === 1 ? item.x : item.x + item.w, y: mid(item) }
}

/** The edge facing the children, at the label's middle. */
function outEdge(item: Item): Point {
  return { x: item.side === 1 ? item.x + item.w : item.x, y: mid(item) }
}

/** Where a top-level branch leaves the root: its side edge, fanned a little toward the branch. */
function rootEdge({ root, item }: { root: Item; item: Item }): Point {
  const room = Math.max(0, root.h / 2 - 10)
  const y = Math.max(-room, Math.min(room, mid(item) * 0.25))
  return { x: item.side * (root.w / 2 - 4), y }
}

function pill({
  item,
  fill,
  stroke,
  tokens,
}: {
  item: Item
  fill: string
  stroke: string
  tokens: Tokens
}): string {
  const r = corner({ tokens, r: Math.min(item.h / 2, 16) })
  return h('path', {
    d: roundedRect({ x: item.x, y: item.y, w: item.w, h: item.h, r }),
    fill,
    stroke,
    'stroke-width': OUTLINE.thin,
  })
}

/** A label centred in its box, or set beside the line `inset` in from the edge facing the parent. */
function text({
  item,
  ctx,
  fill,
  inset,
}: {
  item: Item
  ctx: Context
  fill: string
  inset?: number
}): string {
  const font = { kit: ctx.text, size: item.fontSize, weight: item.weight, lines: item.lines }
  if (inset === undefined) return label({ ...font, x: item.x + item.w / 2, y: mid(item), fill })
  return label({
    ...font,
    x: item.side === 1 ? item.x + inset : item.x + item.w - inset,
    y: mid(item),
    fill,
    anchor: item.side === 1 ? 'start' : 'end',
  })
}

function curve({ from, to }: { from: Point; to: Point }): string {
  const dx = to.x - from.x
  return cubicPath({
    from,
    c1: { x: from.x + dx * 0.5, y: from.y },
    c2: { x: to.x - dx * 0.5, y: to.y },
    to,
  })
}

function line({ d, stroke, width }: { d: string; stroke: string; width: number }): string {
  return h('path', {
    d,
    fill: 'none',
    stroke,
    'stroke-width': width,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  })
}

/** Children grouped under their parent, the root's split by side. */
function families({ root, everything }: Styling): Item[][] {
  const groups = new Map<Item | string, Item[]>()
  for (const item of everything) {
    const key = item.parent && item.parent !== root ? item.parent : `root${item.side}`
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  return [...groups.values()]
}

/**
 * A logic chart: square brackets with rounded corners. Each parent drops a spine halfway to its
 * children and every child hangs off it on a level stub, all in even, thin strokes.
 */
function elbowStyle(styling: Styling): StyledParts {
  const { root, everything, ctx } = styling
  const branches: string[] = []
  for (const kids of families(styling)) {
    const parent = kids[0].parent ?? root
    const top = parent === root
    const from = top ? { x: kids[0].side * (root.w / 2), y: 0 } : outEdge(parent)
    const spineX = from.x + (inEdge(kids[0]).x - from.x) / 2
    const width = top ? 2.5 : 1.75
    const bends = kids.map((kid) => {
      const to = inEdge(kid)
      const r = corner({ tokens: ctx.tokens, r: 10 })
      return { kid, ...elbow({ x: spineX, y: from.y, toX: to.x, toY: to.y, r }) }
    })
    const ys = [from.y, ...bends.map((b) => b.startY)]
    branches.push(
      line({
        d: `M${from.x} ${from.y}H${spineX}M${spineX} ${Math.min(...ys)}V${Math.max(...ys)}`,
        stroke: top ? ctx.tokens.fg : kids[0].swatch.stroke,
        width,
      }),
      ...bends.map((b) => line({ d: b.d, stroke: b.kid.swatch.stroke, width })),
    )
  }
  const tops = everything.filter((item) => item.depth === 1)
  return {
    branches,
    nodes: tops.map((item) =>
      pill({ item, fill: ctx.tokens.surface, stroke: item.swatch.stroke, tokens: ctx.tokens }),
    ),
    labels: everything.map((item) =>
      item.depth === 1
        ? text({ item, ctx, fill: ctx.tokens.fg })
        : text({ item, ctx, fill: ctx.tokens.fg, inset: 4 }),
    ),
  }
}

/** The central topic as a larger outlined card in the same language as the rest, with its label. */
export function rootCard({ root, ctx }: { root: Item; ctx: Context }): string {
  const { tokens } = ctx
  const d = roundedRect({
    x: root.x,
    y: root.y,
    w: root.w,
    h: root.h,
    r: corner({ tokens, r: 12 }),
  })
  return (
    h('path', {
      d,
      fill: tokens.surface,
      stroke: root.node.color ? root.swatch.stroke : tokens.fg,
      'stroke-width': OUTLINE.strong,
    }) + text({ item: root, ctx, fill: tokens.fg })
  )
}

/** Every idea in its own card, joined by even S-curves from edge to edge. */
function cardsStyle({ root, everything, ctx }: Styling): StyledParts {
  const { tokens } = ctx
  const branches = everything.map((item) => {
    const parent = item.parent ?? root
    const from = parent === root ? rootEdge({ root, item }) : outEdge(parent)
    return line({
      d: curve({ from, to: inEdge(item) }),
      stroke: item.swatch.stroke,
      width: item.depth === 1 ? 2.5 : 1.6,
    })
  })
  const nodes = everything.map((item) =>
    item.depth === 1
      ? pill({ item, fill: tokens.surface, stroke: item.swatch.stroke, tokens })
      : h('path', {
          d: roundedRect({
            x: item.x,
            y: item.y,
            w: item.w,
            h: item.h,
            r: corner({ tokens, r: 7 }),
          }),
          fill: tokens.surface,
          stroke: item.swatch.stroke,
          'stroke-width': OUTLINE.thin,
        }),
  )
  return {
    branches,
    nodes,
    labels: everything.map((item) =>
      item.depth === 1
        ? text({ item, ctx, fill: tokens.fg })
        : text({ item, ctx, fill: tokens.fg, inset: 11 }),
    ),
  }
}

/** No boxes below the root: hairline curves that end in a dot, the label set just past it. */
function hairlineStyle({ root, everything, ctx }: Styling): StyledParts {
  const branches = everything.map((item) => {
    const parent = item.parent ?? root
    const from = parent === root ? rootEdge({ root, item }) : outEdge(parent)
    return line({
      d: curve({ from, to: inEdge(item) }),
      stroke: item.swatch.stroke,
      width: item.depth === 1 ? 2 : 1.25,
    })
  })
  const nodes = everything.map((item) => {
    const dot = inEdge(item)
    return h('circle', {
      cx: dot.x,
      cy: dot.y,
      r: item.depth === 1 ? 4.5 : 3.5,
      fill: item.swatch.stroke,
    })
  })
  return {
    branches,
    nodes,
    labels: everything.map((item) =>
      text({
        item,
        ctx,
        fill: ctx.tokens.fg,
        inset: 11,
      }),
    ),
  }
}

export const STYLED: Record<Exclude<MindStyle, 'organic'>, (styling: Styling) => StyledParts> = {
  elbow: elbowStyle,
  cards: cardsStyle,
  hairline: hairlineStyle,
}
