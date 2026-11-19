import {
  type Arc,
  arc,
  arrowHead,
  blob,
  boxExit,
  type Point,
  ribbon,
  roundedRect,
  sampleCubic,
  taper,
} from '../../core/geometry.ts'
import { hitAreas, target, treeIds } from '../../core/hooks.ts'
import { h } from '../../core/svg.ts'
import type { Context, Drawing } from '../../core/types.ts'
import { corner, OUTLINE, WEIGHT } from '../../theme/index.ts'
import { Bounds } from './canvas.ts'
import { label } from './label.ts'
import type { CrossLink, MindmapModel } from './mindmap.ts'
import { layoutOf, styleOf } from './mindmap.ts'
import {
  at,
  type Item,
  inPoint,
  layoutMindmap,
  type MindLayoutResult,
  outPoint,
} from './mindmap-layout.ts'
import { rootCard, STYLED } from './mindmap-styles.ts'
import { walk } from './tidy.ts'

/** Width of the branch line under a node at each depth. */
const LINE = [0, 6, 2.8, 2, 1.6]

function rootOut({ root, side }: { root: Item; side: 1 | -1 }): Point {
  return { x: side * Math.max(0, root.w / 2 - Math.min(root.h / 2, root.w / 4)), y: 0 }
}

/**
 * A branch from the parent to this node as one filled shape: a curve that tapers from the
 * parent's thickness to this node's, then runs straight under the label (except for pills).
 */
function branchPath({
  item,
  root,
  jitter,
}: {
  item: Item
  root: Item
  jitter: () => number
}): string {
  const parent = item.parent ?? root
  const top = item.depth === 1
  const from = top ? rootOut({ root, side: item.side }) : outPoint(parent)
  const begin = { x: parent.depth === 1 ? from.x - item.side * 6 : from.x, y: from.y }
  const arrive = inPoint(item)
  const end = top ? { x: arrive.x + item.side * 6, y: arrive.y } : arrive
  const dx = end.x - begin.x
  const curve = sampleCubic({
    curve: {
      from: begin,
      c1: { x: begin.x + dx * (top ? 0.62 : 0.5) + jitter(), y: begin.y + jitter() },
      c2: { x: end.x - dx * 0.5 + jitter(), y: end.y + jitter() },
      to: end,
    },
    steps: 28,
  })
  const startWidth = top ? 18 : at({ list: LINE, index: parent.depth }) - 0.4
  const endWidth = top ? 7 : at({ list: LINE, index: item.depth })
  const widths = taper({ start: startWidth, end: endWidth, steps: curve.length - 1 })
  if (top) return ribbon({ points: curve, widths })
  const out = outPoint(item)
  const count = Math.max(2, Math.round(Math.abs(out.x - end.x) / 12))
  const under = Array.from({ length: count }, (_, i) => ({
    x: end.x + ((out.x - end.x) * (i + 1)) / count,
    y: end.y,
  }))
  return ribbon({ points: [...curve, ...under], widths: [...widths, ...under.map(() => endWidth)] })
}

function drawLabel({ item, ctx }: { item: Item; ctx: Context }): string {
  const { tokens, text: kit } = ctx
  const font = { kit, size: item.fontSize, weight: item.weight, lines: item.lines }
  if (item.depth <= 1)
    return label({
      ...font,
      x: item.x + item.w / 2,
      y: item.y + item.h / 2,
      fill: item.depth === 0 ? tokens.bg : tokens.fg,
    })
  return label({
    ...font,
    x: item.side === 1 ? item.x + 4 : item.x + item.w - 4,
    y: item.y + (item.lines.length * kit.lineHeight(font)) / 2 + 2,
    fill: tokens.fg,
    anchor: item.side === 1 ? 'start' : 'end',
  })
}

function inside({ p, box }: { p: Point; box: Item }): boolean {
  const inX = p.x > box.x - 4 && p.x < box.x + box.w + 4
  return inX && p.y > box.y - 4 && p.y < box.y + box.h + 4
}

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

function overlaps({ a, b }: { a: Rect; b: Rect }): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/** How many points along a candidate arc land on a node, so links can route around labels. */
function crowding({
  candidate,
  from,
  to,
  boxes,
}: {
  candidate: Arc
  from: Point
  to: Point
  boxes: Item[]
}): number {
  let hits = 0
  for (let i = 1; i < 20; i++) {
    const t = i / 20
    const u = 1 - t
    const p = {
      x: u * u * from.x + 2 * u * t * candidate.control.x + t * t * to.x,
      y: u * u * from.y + 2 * u * t * candidate.control.y + t * t * to.y,
    }
    if (boxes.some((box) => inside({ p, box }))) hits++
  }
  return hits
}

/** The bow that crosses the fewest labels, preferring gentle curves that swing outward. */
function chooseArc({ from, to, boxes }: { from: Point; to: Point; boxes: Item[] }): Arc {
  const short = Math.hypot(to.x - from.x, to.y - from.y) < 160
  const gentle = [0.22, -0.22, 0.35, -0.35, 0.12, -0.12, 0.5, -0.5]
  const wide = [0.8, -0.8, 1.1, -1.1]
  const bulges = short ? [0.6, -0.6, 0.45, -0.45, ...gentle, ...wide] : [...gentle, ...wide]
  const scored = bulges.map((bulge, order) => {
    const candidate = arc({ from, to, bulge })
    const outward = Math.hypot(candidate.mid.x, candidate.mid.y) / 1000
    const hits = crowding({ candidate, from, to, boxes })
    const tag = { x: candidate.mid.x - 30, y: candidate.mid.y - 9, w: 60, h: 18 }
    const covered = boxes.some((box) => overlaps({ a: tag, b: box })) ? 15 : 0
    return { candidate, score: hits * 10 + covered + Math.floor(order / 2) * 0.5 - outward }
  })
  scored.sort((p, q) => p.score - q.score)
  return scored[0].candidate
}

function drawRoot({ root, ctx }: { root: Item; ctx: Context }): string {
  const { tokens, rng } = ctx
  const sketch = tokens.look === 'sketch'
  if (sketch)
    return blob({
      cx: 0,
      cy: 0,
      rx: root.w / 2 + 6,
      ry: root.h / 2 + 4,
      rng: rng.fork('root'),
      wobble: 0.05,
      count: 10,
    })
  const r = corner({ tokens, r: Math.min(root.h / 2, 26) })
  return roundedRect({ x: root.x, y: root.y, w: root.w, h: root.h, r })
}

function linkLabel({
  link,
  mid,
  ctx,
  bounds,
}: {
  link: CrossLink
  mid: Point
  ctx: Context
  bounds: Bounds
}): string[] {
  if (!link.label) return []
  const { tokens, text: kit } = ctx
  const font = { size: 12.5, weight: WEIGHT.body }
  const lines = kit.wrap(link.label, { ...font, max: 150 })
  const w = Math.max(...lines.map((l) => kit.width(l, font))) + 16
  const hh = lines.length * kit.lineHeight(font) + 7
  const box = { x: mid.x - w / 2, y: mid.y - hh / 2, w, h: hh }
  bounds.add(box)
  return [
    h('path', {
      d: roundedRect({ ...box, r: corner({ tokens, r: Math.min(hh / 2, 10) }) }),
      fill: tokens.bg,
      stroke: tokens.border,
      'stroke-width': OUTLINE.thin,
    }),
    label({ kit, ...mid, lines, ...font, fill: tokens.muted }),
  ]
}

/** A dashed, gently curved cross-link that bows away from the centre, with an arrowhead. */
function drawLink({
  link,
  id,
  placed,
  ctx,
  bounds,
}: {
  link: CrossLink
  id: string
  placed: MindLayoutResult
  ctx: Context
  bounds: Bounds
}): string {
  const a = placed.items.get(link.from)
  const b = placed.items.get(link.to)
  if (!a || !b || a === b) return ''
  const ink = ctx.tokens.muted
  const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 }
  const cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 }
  const from = boxExit({ center: ca, w: a.w, h: a.h, toward: cb, pad: 6 })
  const to = boxExit({ center: cb, w: b.w, h: b.h, toward: ca, pad: 8 })
  const boxes = [...placed.items.values()].filter((item) => item !== a && item !== b)
  const chosen = chooseArc({ from, to, boxes })
  bounds.add({ x: chosen.mid.x - 4, y: chosen.mid.y - 4, w: 8, h: 8 })
  const back = Math.atan2(from.y - chosen.control.y, from.x - chosen.control.x)
  return h(
    'g',
    { ...target({ id, kind: 'link', tint: ink }), class: 'mm-link' },
    h('path', {
      d: chosen.d,
      fill: 'none',
      stroke: ink,
      'stroke-width': 1.6,
      'stroke-dasharray': '5 5',
      'stroke-linecap': 'round',
    }),
    h('path', { d: arrowHead({ tip: to, angle: chosen.endAngle, size: 10 }), fill: ink }),
    link.both && h('path', { d: arrowHead({ tip: from, angle: back, size: 10 }), fill: ink }),
    ...linkLabel({ link, mid: chosen.mid, ctx, bounds }),
  )
}

export function renderMindmap(model: MindmapModel, ctx: Context): Drawing {
  const { tokens, text: kit, rng } = ctx
  const sketch = tokens.look === 'sketch'
  const layout = model.layout ?? layoutOf(ctx.options.layout) ?? 'balanced'
  const style = model.style ?? styleOf(ctx.options.style) ?? 'cards'
  const placed = layoutMindmap({ root: model.root, layout, style, kit, tokens })
  const { root, tops } = placed
  const everything = tops.flatMap((top) => walk(top))
  const bounds = new Bounds()
  for (const item of [root, ...everything]) bounds.add(item)
  const ids = treeIds(model.root)
  const links = model.links.map((link) =>
    drawLink({
      link,
      id: `${ids.get(link.from) ?? ''}->${ids.get(link.to) ?? ''}`,
      placed,
      ctx,
      bounds,
    }),
  )
  const hits = hitAreas(
    [root, ...everything].map((item) => ({
      id: ids.get(item === root ? model.root : item.node) ?? '',
      kind: 'node',
      tint: item.swatch.stroke,
      box: item,
    })),
  )
  const rootShape = h('path', {
    d: drawRoot({ root, ctx }),
    fill: root.node.color ? root.swatch.strong : tokens.fg,
    filter: 'url(#mm-shadow)',
  })
  if (style !== 'organic') {
    const parts = STYLED[style]({ root, everything, ctx })
    const body = [
      h('g', { class: 'mm-branches' }, ...parts.branches),
      h('g', { class: 'mm-nodes' }, ...parts.nodes),
      h('g', { class: 'mm-root' }, rootCard({ root, ctx })),
      h('g', { class: 'mm-labels' }, ...parts.labels),
      ...links,
      hits,
    ].join('')
    return bounds.drawing({ body, margin: 32, title: model.root.label })
  }
  const jitter = () => (sketch ? rng.normal() * 2.2 : 0)
  const ribbons = [...everything]
    .sort((p, q) => q.depth - p.depth)
    .map((item) => h('path', { d: branchPath({ item, root, jitter }), fill: item.swatch.stroke }))
  const pills = tops.map((item) =>
    h('path', {
      d: roundedRect({
        x: item.x,
        y: item.y,
        w: item.w,
        h: item.h,
        r: corner({ tokens, r: Math.min(item.h / 2, 16) }),
      }),
      fill: tokens.surface,
      stroke: item.swatch.stroke,
      'stroke-width': OUTLINE.thin,
    }),
  )
  const body = [
    h('g', { class: 'mm-branches' }, ...ribbons),
    h('g', { class: 'mm-pills', filter: 'url(#mm-shadow)' }, ...pills),
    rootShape,
    h(
      'g',
      { class: 'mm-labels' },
      ...[root, ...everything].map((item) => drawLabel({ item, ctx })),
    ),
    ...links,
    hits,
  ].join('')
  return bounds.drawing({ body, margin: 32, title: model.root.label })
}
