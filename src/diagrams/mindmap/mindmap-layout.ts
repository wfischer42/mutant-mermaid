import type { Point } from '../../core/geometry.ts'
import type { TextKit } from '../../core/text.ts'
import { pick, type Swatch, swatchFor, type Tokens, WEIGHT } from '../../theme/index.ts'
import { wrapEven } from './label.ts'
import type { MindLayout, MindNode, MindStyle } from './mindmap.ts'
import { type Tidy, tidy, walk } from './tidy.ts'

/** One mind map node as placed: measured, coloured and positioned. */
export interface Item extends Tidy<Item> {
  node: MindNode
  depth: number
  side: 1 | -1
  swatch: Swatch
  lines: string[]
  fontSize: number
  weight: number
  w: number
  h: number
  x: number
  y: number
  parent?: Item
}

export const FONT = [
  { size: 20, weight: WEIGHT.title, max: 220 },
  { size: 16, weight: WEIGHT.heading, max: 170 },
  { size: 15, weight: WEIGHT.body, max: 180 },
  { size: 14, weight: WEIGHT.body, max: 170 },
]
/** Distance along the main axis from a parent at each depth to its children, per style. */
const REACH: Record<MindStyle, number[]> = {
  organic: [0, 44, 30, 26],
  elbow: [0, 56, 40, 34],
  cards: [0, 52, 40, 34],
  hairline: [0, 48, 34, 30],
}
/** Padding around a label at each depth, per style; the last entry covers deeper levels. */
const PAD: Record<MindStyle, { x: number[]; y: number[] }> = {
  organic: { x: [26, 15, 4], y: [15, 8, 4] },
  elbow: { x: [26, 15, 4], y: [15, 8, 5] },
  cards: { x: [26, 15, 11], y: [15, 8, 6] },
  hairline: { x: [26, 9, 9], y: [15, 6, 5] },
}
/** Clearance between neighbouring subtrees under a node at each depth. */
const GAPS = [26, 12, 6]

export function at<T>({ list, index }: { list: T[]; index: number }): T {
  return list[Math.min(index, list.length - 1)]
}

export function leaves(node: MindNode): number {
  return node.children.length ? node.children.reduce((sum, c) => sum + leaves(c), 0) : 1
}

/**
 * How many of the root's children go on the right so both halves hold about as many leaves.
 * The right takes the first ones, so reading runs clockwise from the top right.
 */
export function splitPoint({ weights }: { weights: number[] }): number {
  if (weights.length <= 1) return weights.length
  const total = weights.reduce((a, b) => a + b, 0)
  let best = 1
  let bestDiff = Number.POSITIVE_INFINITY
  let running = 0
  for (let k = 1; k < weights.length; k++) {
    running += weights[k - 1]
    const diff = Math.abs(total - 2 * running)
    if (diff < bestDiff - 1e-9) {
      best = k
      bestDiff = diff
    }
  }
  return best
}

interface Measure {
  kit: TextKit
  tokens: Tokens
  style: MindStyle
}

/** Measures a node and its subtree; pills at the root and first level, underlined text below. */
function measure({
  node,
  depth,
  side,
  swatch,
  parent,
  env,
}: {
  node: MindNode
  depth: number
  side: 1 | -1
  swatch: Swatch
  parent?: Item
  env: Measure
}): Item {
  const font = at({ list: FONT, index: depth })
  const style = { size: font.size, weight: font.weight }
  const lines = wrapEven({ kit: env.kit, text: node.label || ' ', style, max: font.max })
  const textW = Math.max(...lines.map((l) => env.kit.width(l, style)))
  const textH = lines.length * env.kit.lineHeight(style)
  const pad = PAD[env.style]
  const padX = at({ list: pad.x, index: depth })
  const padY = at({ list: pad.y, index: depth })
  const item: Item = {
    node,
    depth,
    side,
    swatch,
    lines,
    fontSize: font.size,
    weight: font.weight,
    w: textW + padX * 2,
    h: textH + padY * 2,
    size: textH + padY * 2,
    x: 0,
    y: 0,
    lo: 0,
    hi: 0,
    children: [],
    offset: 0,
    center: 0,
    parent,
  }
  item.children = node.children.map((child) =>
    measure({
      node: child,
      depth: depth + 1,
      side,
      swatch: (child.color && swatchFor({ tokens: env.tokens, color: child.color })) || swatch,
      parent: item,
      env,
    }),
  )
  return item
}

function reach({ item, u, style }: { item: Item; u: number; style: MindStyle }): void {
  item.lo = u
  item.hi = u + item.w
  const next = u + item.w + at({ list: REACH[style], index: item.depth })
  for (const child of item.children) reach({ item: child, u: next, style })
}

/** Lays out one side's branches as a horizontal tidy tree beside the root. */
function placeSide({
  tops,
  root,
  side,
  style,
}: {
  tops: Item[]
  root: Item
  side: 1 | -1
  style: MindStyle
}): void {
  for (const top of tops) reach({ item: top, u: 0, style })
  const holder: Item = { ...root, lo: -40, hi: -30, size: 0, children: tops }
  tidy({ root: holder, gap: (depth) => at({ list: GAPS, index: depth }) })
  const spread = Math.max(0, ...tops.map((t) => Math.abs(t.center)))
  const start = root.w / 2 + Math.min(130, Math.max(64, spread * 0.32))
  for (const item of tops.flatMap((top) => walk(top))) {
    item.x = side === 1 ? start + item.lo : -start - item.lo - item.w
    item.y = item.center - item.h / 2
  }
}

export interface MindLayoutResult {
  root: Item
  tops: Item[]
  items: Map<MindNode, Item>
}

/** Measures and places every node: the root at (0, 0), branches split between the two sides. */
export function layoutMindmap({
  root: node,
  layout,
  style = 'cards',
  kit,
  tokens,
}: {
  root: MindNode
  layout: MindLayout
  style?: MindStyle
  kit: TextKit
  tokens: Tokens
}): MindLayoutResult {
  const env = { kit, tokens, style }
  const rootSwatch = (node.color && swatchFor({ tokens, color: node.color })) || tokens.accent
  const root = measure({
    node: { ...node, children: [] },
    depth: 0,
    side: 1,
    swatch: rootSwatch,
    env,
  })
  root.x = -root.w / 2
  root.y = -root.h / 2
  const branches = node.children.map((child, i) => ({
    child,
    swatch:
      (child.color && swatchFor({ tokens, color: child.color })) || pick({ tokens, index: i }),
  }))
  const weights = branches.map((b) => leaves(b.child))
  const split = layout === 'right' ? branches.length : splitPoint({ weights })
  const side = ({ group, dir }: { group: typeof branches; dir: 1 | -1 }) =>
    group.map((b) =>
      measure({ node: b.child, depth: 1, side: dir, swatch: b.swatch, parent: root, env }),
    )
  const right = side({ group: branches.slice(0, split), dir: 1 })
  const left = side({ group: branches.slice(split).reverse(), dir: -1 })
  placeSide({ tops: right, root, side: 1, style })
  placeSide({ tops: left, root, side: -1, style })
  const tops = [...right, ...left]
  const items = new Map<MindNode, Item>([[node, root]])
  for (const item of tops.flatMap((top) => walk(top))) items.set(item.node, item)
  return { root, tops, items }
}

/** Where a node's branch line runs: the pill's middle, or just under an underlined label. */
export function anchorY(item: Item): number {
  return item.depth <= 1 ? item.y + item.h / 2 : item.y + item.h - 1.5
}

/** Where the branch from the parent arrives. */
export function inPoint(item: Item): Point {
  return { x: item.side === 1 ? item.x : item.x + item.w, y: anchorY(item) }
}

/** Where branches to the children leave. */
export function outPoint(item: Item): Point {
  return { x: item.side === 1 ? item.x + item.w : item.x, y: anchorY(item) }
}
