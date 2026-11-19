import { arrowHead, roundedRect } from '../../core/geometry.ts'
import { type Diagnostic, indentTree, readLines, type TreeNode, unquote } from '../../core/parse.ts'
import { g, h, n } from '../../core/svg.ts'
import type { Context, DiagramType, Drawing, Parsed } from '../../core/types.ts'
import { corner as cornerRadius, OUTLINE, type Swatch, WEIGHT } from '../../theme/index.ts'
import {
  Bounds,
  blockHeight,
  type ChipSize,
  chipSize,
  drawChip,
  flow,
  frame,
  type Item,
  LABEL,
  NOTE,
  poles,
  readHead,
  readItem,
  sayer,
  tone,
  wash,
} from './common.ts'

/**
 * A 2×2 matrix: two axes, four named quadrants, items as chips inside them.
 *
 *   matrix "Prioritize"
 *     x Low effort .. High effort
 *     y Low impact .. High impact
 *     quadrant "Quick wins" top-left
 *       Fix onboarding copy
 *     Major projects top-right
 *       Rebuild search
 *     Dark mode @ 0.3,0.6
 *
 * Quadrants without a position fill top-left, top-right, bottom-left, bottom-right in order.
 * `Item @ x,y` (0–1 on each axis) plots a point; Mermaid's `x-axis A --> B`, `quadrant-1 Name`
 * and `Item: [x, y]` also work.
 */
export type Corner = 'tl' | 'tr' | 'bl' | 'br'

export interface Quadrant extends Item {
  corner: Corner
  items: Item[]
}

export interface MatrixModel {
  title: string
  x?: [string, string]
  y?: [string, string]
  quadrants: Quadrant[]
  points: Item[]
}

const CORNERS: Corner[] = ['tl', 'tr', 'bl', 'br']

const CORNER_WORDS: Record<string, Corner> = {
  'top-left': 'tl',
  'top-right': 'tr',
  'bottom-left': 'bl',
  'bottom-right': 'br',
  topleft: 'tl',
  topright: 'tr',
  bottomleft: 'bl',
  bottomright: 'br',
  tl: 'tl',
  tr: 'tr',
  bl: 'bl',
  br: 'br',
  q1: 'tr',
  q2: 'tl',
  q3: 'bl',
  q4: 'br',
}

/** Default hue per corner: green for the sweet spot, blue, amber, coral for the worst. */
const CORNER_INDEX: Record<Corner, number> = { tl: 1, tr: 2, bl: 3, br: 0 }

interface Reading {
  model: MatrixModel
  diagnostics: Diagnostic[]
  pending: { node: TreeNode; item: Item }[]
}

/**
 * `quadrant "Name" top-left : note`, `Name top-left`, `quadrant-2 Name`, or a bare name that
 * takes the next free corner.
 */
function readQuadrant({ node, reading }: { node: TreeNode; reading: Reading }): boolean {
  const text = node.line.text
  const mermaid = /^quadrant-([1-4])\s+(.+)$/i.exec(text)
  const named = /^quadrant\s+(.+)$/i.exec(text)
  const trailing = /\s+(top-?left|top-?right|bottom-?left|bottom-?right|tl|tr|bl|br|q[1-4])$/i
  const raw = readItem({ ...node.line, text: mermaid?.[2] ?? named?.[1] ?? text })
  const position = trailing.exec(raw.label)
  const corner = mermaid
    ? CORNER_WORDS[`q${mermaid[1]}`]
    : position && CORNER_WORDS[position[1].toLowerCase()]
  const label = unquote(position ? raw.label.slice(0, position.index).trim() : raw.label)
  const item = { ...raw, label }
  const items = node.children.map((child) => readItem(child.line))
  if (corner) reading.model.quadrants.push({ ...item, corner, items })
  else reading.pending.push({ node, item })
  return true
}

function readPoint({ node, reading }: { node: TreeNode; reading: Reading }): boolean {
  const bracket = /^(.*?):\s*\[\s*([\d.]+)\s*,\s*([\d.]+)\s*\]\s*(.*)$/.exec(node.line.text)
  const text = bracket
    ? `${bracket[1]} ${bracket[4]} @ ${bracket[2]},${bracket[3]}`
    : node.line.text
  const item = readItem({ ...node.line, text }, { positions: true })
  if (!item.at || item.at.length < 2) return false
  reading.model.points.push(item)
  return true
}

/**
 * `x Low .. High`, `y: Low --> High` or Mermaid's `x-axis …`. A line with two poles or `-axis` is an
 * axis; anything else starting with X or Y ("X factor", "Y combinator") is left for a quadrant.
 */
function readAxis({ node, reading }: { node: TreeNode; reading: Reading }): boolean {
  const axis = /^([xy])(?:-axis)?\s*:?\s+(.+)$/i.exec(node.line.text)
  if (!axis) return false
  const ends = poles(axis[2])
  if (!ends && !/^[xy]-axis/i.test(node.line.text)) return false
  const key = axis[1].toLowerCase() === 'x' ? 'x' : 'y'
  if (ends) reading.model[key] = ends
  else
    reading.diagnostics.push({
      line: node.line.no,
      message: `Write the ${key} axis as \`${key} Low .. High\`.`,
      severity: 'warning',
    })
  return true
}

export function parseMatrix(source: string): Parsed<MatrixModel> {
  const [first, ...rest] = readLines(source)
  const head = readHead(first)
  const reading: Reading = {
    model: { title: head.title, quadrants: [], points: [] },
    diagnostics: [],
    pending: [],
  }
  for (const node of indentTree(rest)) {
    const handled =
      readAxis({ node, reading }) || readPoint({ node, reading }) || readQuadrant({ node, reading })
    if (!handled)
      reading.diagnostics.push({
        line: node.line.no,
        message: `"${node.line.text}" isn't a quadrant, axis or point; indent items under a quadrant, or give a position like \`@ 0.3,0.7\`.`,
        severity: 'warning',
      })
  }
  const free = CORNERS.filter((c) => !reading.model.quadrants.some((q) => q.corner === c))
  reading.pending.forEach(({ item, node }, i) => {
    if (i < free.length)
      reading.model.quadrants.push({
        ...item,
        corner: free[i],
        items: node.children.map((c) => readItem(c.line)),
      })
    else
      reading.diagnostics.push({
        line: node.line.no,
        message: 'A matrix has only four quadrants.',
        severity: 'warning',
      })
  })
  if (!reading.model.quadrants.length && !reading.model.points.length)
    reading.diagnostics.push({
      line: head.line,
      message:
        'A matrix needs quadrants (`quadrant "Quick wins" top-left`) or points (`Item @ 0.2,0.8`).',
      severity: 'error',
    })
  return { model: reading.model, diagnostics: reading.diagnostics }
}

interface Cell {
  corner: Corner
  quadrant?: Quadrant
  swatch: Swatch
  heading: string[]
  note: string[]
  chips: ChipSize[]
  chipAt: { x: number; y: number }[]
  chipsH: number
}

const CELL_W = 290
const PAD = 18

function measureCells({ model, ctx }: { model: MatrixModel; ctx: Context }): Cell[] {
  const kit = ctx.text
  const inner = CELL_W - PAD * 2
  return CORNERS.map((corner) => {
    const quadrant = model.quadrants.find((q) => q.corner === corner)
    const chips = (quadrant?.items ?? []).map((item) =>
      chipSize({ kit, label: item.label, size: 13, max: inner }),
    )
    const packed = flow({ sizes: chips, max: inner, gap: 8 })
    return {
      corner,
      quadrant,
      swatch: tone({ tokens: ctx.tokens, color: quadrant?.color, index: CORNER_INDEX[corner] }),
      heading: quadrant
        ? kit.wrap(quadrant.label, { size: LABEL + 1, weight: WEIGHT.heading, max: inner })
        : [],
      note: quadrant?.note ? kit.wrap(quadrant.note, { size: NOTE, max: inner }) : [],
      chips,
      chipAt: packed.at,
      chipsH: packed.h,
    }
  })
}

function cellHeight({ cell, ctx }: { cell: Cell; ctx: Context }): number {
  const kit = ctx.text
  const head = blockHeight({ kit, count: cell.heading.length, size: LABEL + 1 })
  const note = cell.note.length ? 4 + blockHeight({ kit, count: cell.note.length, size: NOTE }) : 0
  return PAD + head + note + (cell.chips.length ? 14 + cell.chipsH : 0) + PAD
}

export function renderMatrix(model: MatrixModel, ctx: Context): Drawing {
  const { tokens } = ctx
  const cells = measureCells({ model, ctx })
  const pointRoom = model.points.length ? 120 : 0
  const cellH = Math.max(150 + pointRoom / 2, ...cells.map((cell) => cellHeight({ cell, ctx })))
  const cellW = CELL_W + pointRoom / 2
  const size = { w: cellW * 2, h: cellH * 2 }
  const bounds = new Bounds()
  bounds.add({ x: 0, y: 0, ...size })
  const origin = (corner: Corner) => ({
    x: corner === 'tl' || corner === 'bl' ? 0 : cellW,
    y: corner === 'tl' || corner === 'tr' ? 0 : cellH,
  })
  const outline = roundedRect({ x: 0, y: 0, ...size, r: cornerRadius({ tokens, r: 16 }) })
  const clip = h('path', { d: outline })
  const fills = cells.map((cell) =>
    h('rect', {
      ...origin(cell.corner),
      width: cellW,
      height: cellH,
      fill: wash({ tokens, swatch: cell.swatch }),
    }),
  )
  const grid = [
    h('path', {
      d: `M${n(cellW)} 0V${n(size.h)}M0 ${n(cellH)}H${n(size.w)}`,
      stroke: tokens.bg,
      'stroke-width': 6,
    }),
    h('path', {
      d: outline,
      fill: 'none',
      stroke: tokens.border,
      'stroke-width': OUTLINE.thin,
    }),
  ]
  const id = `mm-matrix-${Math.floor(ctx.rng.fork('matrix').next() * 1e8).toString(36)}`
  const body = g(
    {},
    g({ 'clip-path': `url(#${id})` }, ...fills),
    ...grid,
    ...cells.map((cell) => cellContent({ ctx, cell, ...origin(cell.corner) })),
    axes({ ctx, model, size, bounds }),
    ...plotAll({
      ctx,
      points: model.points,
      size,
      cells,
      obstacles: cells
        .filter((cell) => cell.quadrant)
        .map((cell) => contentBox({ cell, ...origin(cell.corner), ctx })),
    }),
  )
  return frame({
    ctx,
    title: model.title,
    body,
    bounds,
    defs: h('clipPath', { id }, clip),
  })
}

function cellContent({
  ctx,
  cell,
  x,
  y,
}: {
  ctx: Context
  cell: Cell
  x: number
  y: number
}): string {
  const { text: kit } = ctx
  const say = sayer(kit)
  if (!cell.quadrant) return ''
  const headH = blockHeight({ kit, count: cell.heading.length, size: LABEL + 1 })
  const noteH = cell.note.length ? blockHeight({ kit, count: cell.note.length, size: NOTE }) : 0
  const chipsTop = y + PAD + headH + (noteH ? noteH + 4 : 0) + 14
  return g(
    {},
    say({
      x: x + PAD,
      y: y + PAD + headH / 2,
      lines: cell.heading,
      size: LABEL + 1,
      weight: WEIGHT.heading,
      fill: ctx.tokens.fg,
      anchor: 'start',
    }),
    noteH
      ? say({
          x: x + PAD,
          y: y + PAD + headH + 4 + noteH / 2,
          lines: cell.note,
          size: NOTE,
          fill: ctx.tokens.muted,
          anchor: 'start',
        })
      : '',
    ...cell.chips.map((size, i) =>
      drawChip({
        ctx,
        x: x + PAD + cell.chipAt[i].x,
        y: chipsTop + cell.chipAt[i].y,
        size,
        swatch: { ...cell.swatch, soft: ctx.tokens.surface },
      }),
    ),
  )
}

/** Arrows along the bottom and left edges, with each pole's label at its end. */
function axes({
  ctx,
  model,
  size,
  bounds,
}: {
  ctx: Context
  model: MatrixModel
  size: { w: number; h: number }
  bounds: Bounds
}): string {
  const { tokens, text: kit } = ctx
  const say = sayer(kit)
  const parts: string[] = []
  const style = { size: NOTE, weight: WEIGHT.heading }
  const line = { stroke: tokens.muted, 'stroke-width': 1.6, 'stroke-linecap': 'round' as const }
  if (model.x) {
    const y = size.h + 16
    parts.push(
      h('path', { d: `M0 ${n(y)}H${n(size.w - 4)}`, ...line }),
      h('path', { d: arrowHead({ tip: { x: size.w, y }, angle: 0, size: 9 }), fill: tokens.muted }),
      say({ x: 0, y: y + 18, lines: [model.x[0]], ...style, fill: tokens.muted, anchor: 'start' }),
      say({ x: size.w, y: y + 18, lines: [model.x[1]], ...style, fill: tokens.fg, anchor: 'end' }),
    )
    bounds.add({ x: 0, y, w: size.w, h: 28 })
  }
  if (model.y) {
    const x = -16
    parts.push(
      h('path', { d: `M${n(x)} ${n(size.h)}V4`, ...line }),
      h('path', {
        d: arrowHead({ tip: { x, y: 0 }, angle: -Math.PI / 2, size: 9 }),
        fill: tokens.muted,
      }),
    )
    const labels = [
      { text: model.y[1], y: 10, fill: tokens.fg },
      { text: model.y[0], y: size.h - 6, fill: tokens.muted },
    ]
    for (const label of labels) {
      const lines = kit.wrap(label.text, { ...style, max: 110 })
      parts.push(say({ x: x - 12, y: label.y, lines, ...style, fill: label.fill, anchor: 'end' }))
      bounds.addText({ kit, x: x - 12, y: label.y, lines, ...style, anchor: 'end' })
    }
  }
  return g({}, ...parts)
}

interface Box {
  x: number
  y: number
  w: number
  h: number
}

type Anchor = 'start' | 'end' | 'middle'

interface Dot {
  point: Item
  x: number
  y: number
  swatch: Swatch
}

interface Spot {
  x: number
  y: number
  anchor: Anchor
}

const POINT_TEXT = { size: 13, weight: WEIGHT.body }
const DOT_R = 6.5

function overlap({ box, other }: { box: Box; other: Box }): number {
  const w = Math.min(box.x + box.w, other.x + other.w) - Math.max(box.x, other.x)
  const hh = Math.min(box.y + box.h, other.y + other.h) - Math.max(box.y, other.y)
  return w > 0 && hh > 0 ? w * hh : 0
}

/** The area a quadrant's name, note and chips cover, from its top-left corner. */
function contentBox({ cell, x, y, ctx }: { cell: Cell; x: number; y: number; ctx: Context }): Box {
  const kit = ctx.text
  const widths = [
    ...cell.heading.map((line) => kit.width(line, { size: LABEL + 1, weight: WEIGHT.heading })),
    ...cell.note.map((line) => kit.width(line, { size: NOTE })),
    cell.chips.length ? CELL_W - PAD * 2 : 0,
  ]
  return { x: x + PAD, y: y + PAD, w: Math.max(...widths), h: cellHeight({ cell, ctx }) - PAD * 2 }
}

function dotOf({
  point,
  size,
  cells,
  tokens,
}: {
  point: Item
  size: { w: number; h: number }
  cells: Cell[]
  tokens: Context['tokens']
}): Dot {
  const [px, py] = point.at ?? [0.5, 0.5]
  const cell = cells.find((c) => c.corner === cornerOf({ px, py }))
  const swatch =
    (point.color && tone({ tokens, color: point.color, index: 0 })) || cell?.swatch || tokens.accent
  return { point, x: 14 + px * (size.w - 28), y: 14 + (1 - py) * (size.h - 28), swatch }
}

/** Places to try for a label, nearest first: beside the dot, then above or below it. */
function spots(dot: Dot): Spot[] {
  const { x, y } = dot
  return [
    { x: x + 12, y, anchor: 'start' },
    { x: x - 12, y, anchor: 'end' },
    { x: x + 10, y: y - 15, anchor: 'start' },
    { x: x + 10, y: y + 15, anchor: 'start' },
    { x: x - 10, y: y - 15, anchor: 'end' },
    { x: x - 10, y: y + 15, anchor: 'end' },
    { x, y: y - 19, anchor: 'middle' },
    { x, y: y + 19, anchor: 'middle' },
  ]
}

function boxAt({ spot, w, h: hh }: { spot: Spot; w: number; h: number }): Box {
  const shift = { start: 0, end: w, middle: w / 2 }[spot.anchor]
  return { x: spot.x - shift - 2, y: spot.y - hh / 2, w: w + 4, h: hh }
}

/** How much a label box hits what's already placed, plus how far it leaves the matrix. */
function cost({ box, taken, size }: { box: Box; taken: Box[]; size: { w: number; h: number } }) {
  const hits = taken.reduce((sum, other) => sum + overlap({ box, other }), 0)
  const inside = overlap({ box, other: { x: 0, y: 0, ...size } })
  return hits + (box.w * box.h - inside) * 0.5
}

/**
 * Puts each point's label in the first spot that's clear of other labels, the dots and the
 * quadrants' text, or in the least crowded spot when none is.
 */
function placeLabels({
  dots,
  obstacles,
  size,
  ctx,
}: {
  dots: Dot[]
  obstacles: Box[]
  size: { w: number; h: number }
  ctx: Context
}): Spot[] {
  const kit = ctx.text
  const hh = kit.lineHeight({ size: POINT_TEXT.size })
  const ring = DOT_R + 2
  const taken = [
    ...obstacles,
    ...dots.map((d) => ({ x: d.x - ring, y: d.y - ring, w: ring * 2, h: ring * 2 })),
  ]
  return dots.map((dot) => {
    const w = kit.width(dot.point.label, POINT_TEXT)
    const scored = spots(dot).map((spot) => {
      const box = boxAt({ spot, w, h: hh })
      return { spot, box, cost: cost({ box, taken, size }) }
    })
    const best =
      scored.find((s) => s.cost < 1) ?? scored.reduce((a, b) => (b.cost < a.cost ? b : a))
    taken.push(best.box)
    return best.spot
  })
}

/** Every plotted point: a dot, with its label placed clear of the others. */
function plotAll({
  ctx,
  points,
  size,
  cells,
  obstacles,
}: {
  ctx: Context
  points: Item[]
  size: { w: number; h: number }
  cells: Cell[]
  obstacles: Box[]
}): string[] {
  const { tokens } = ctx
  const say = sayer(ctx.text)
  const dots = points.map((point) => dotOf({ point, size, cells, tokens }))
  const labels = placeLabels({ dots, obstacles, size, ctx })
  return dots.map((dot, i) =>
    g(
      {},
      h('circle', {
        cx: dot.x,
        cy: dot.y,
        r: DOT_R,
        fill: dot.swatch.strong,
        stroke: tokens.surface,
        'stroke-width': 2.5,
      }),
      say({ ...labels[i], lines: [dot.point.label], ...POINT_TEXT, fill: tokens.fg }),
    ),
  )
}

function cornerOf({ px, py }: { px: number; py: number }): Corner {
  if (py >= 0.5) return px < 0.5 ? 'tl' : 'tr'
  return px < 0.5 ? 'bl' : 'br'
}

export const matrix: DiagramType<MatrixModel> = {
  id: 'matrix',
  keywords: ['matrix', '2x2', 'quadrants'],
  title: 'Matrix',
  summary:
    'A 2×2 matrix with labelled axes, four named quadrants holding item chips, and optional plotted points.',
  guide: {
    useWhen: 'items sort along two independent dimensions into four kinds.',
    syntax: `
Axes, then quadrants with their items indented under them, then any points:

\`\`\`
matrix "Title"
  x Low effort .. High effort            %% x axis: left pole .. right pole
  y Low impact .. High impact            %% y axis: bottom pole .. top pole
  quadrant "Quick wins" top-left : do these first
    Fix onboarding copy                  %% an item: a chip in that quadrant
  Major projects top-right #blue         %% the word quadrant is optional
  Fill-ins                               %% no corner: takes the next free one
  Dark mode @ 0.3,0.6                    %% a point plotted at x,y
\`\`\`

- **Each unindented line is one of three things**, tried in this order: an axis if it starts
  with \`x\` or \`y\` (any case) and gives two poles, or is Mermaid's \`x-axis\`/\`y-axis\`; a
  point if it ends with \`@ x,y\`; and otherwise a quadrant. So "Y combinator" is a quadrant.
- **Axes:** \`x Left .. Right\` and \`y Bottom .. Top\`. \`x:\` and Mermaid's \`x-axis\` work too.
  The separator can be \`..\`, \`->\`, \`-->\`, \`<->\`, \`→\` or \`↔\`. Give both poles: one alone
  warns and draws no axis. Axes are optional.
- **Quadrants:** \`quadrant "Name" corner : note #color\`. The word \`quadrant\` and the quotes
  can be left out (\`Major projects top-right\`). Corners: \`top-left\`, \`top-right\`,
  \`bottom-left\`, \`bottom-right\`, also written \`topleft\`, \`tl\`, \`tr\`, \`bl\`, \`br\`, any case.
  Mermaid numbering works too: \`q1\` or \`quadrant-1 Name\` is top-right, \`q2\` top-left, \`q3\`
  bottom-left, \`q4\` bottom-right. The corner goes before the \` : note\`.
- **Picking corners:** a quadrant with a corner takes it, wherever its line is. The others fill
  the free corners in order: top-left, top-right, bottom-left, bottom-right. A fifth quadrant
  warns and is dropped. If two quadrants name the same corner, only the first is drawn, with no
  warning.
- **Items** are the lines indented under a quadrant, drawn as chips in its color. Only the label
  shows: an item's note, \`#color\` and \`@\` are ignored, and so are lines nested under it.
- **Points:** an unindented \`Label @ x,y\`, each from 0 to 1 (x: left to right, y: bottom to
  top). Mermaid's \`Label: [0.3, 0.6]\` works too. A point needs both numbers: \`Label @ 0.3\`
  becomes a quadrant with that whole text as its name. Indented under a quadrant it becomes a
  chip. A point takes the color of the quadrant it lands in, or its own \`#color\`. Its note isn't
  shown. A point's label goes to the right of its dot, or moves left, above or below to keep clear
  of other labels and of each quadrant's name, note and chips. The dots themselves never move, so
  a dot placed on a quadrant's name still covers it.
- You need at least one quadrant or one point. Quadrants and points can be mixed.
- **Colors:** each corner has its own default. \`#color\` takes a name (\`red\`, \`coral\`,
  \`orange\`, \`amber\`, \`yellow\`, \`lime\`, \`green\`, \`moss\`, \`teal\`, \`cyan\`, \`sky\`, \`blue\`,
  \`indigo\`, \`violet\`, \`purple\`, \`magenta\`, \`pink\`, \`rose\`, \`brown\`, \`grey\`) or a hex
  value like \`#e4572e\`.
- **Text:** a colon followed by a space starts the note, except inside quotes:
  \`"Plan: Pro" : yearly\`. At the end of a line, a \`#color\` (palette name or hex), \`!word\` or
  \`key=value\` is read as an option and taken out of the text; any other \`#word\`, like
  \`Ship #launch\`, stays in it. Quote a label to keep a trailing \`!word\` or \`key=value\`.
  A point's \`@ x,y\` must be the last thing on its line.`,
    example: `
matrix "Feature backlog: effort vs. impact"
  x Low effort .. High effort
  y Low impact .. High impact
  quadrant "Quick wins" top-left : do these first
    Fix onboarding copy
    Cache the dashboard
  quadrant "Major projects" top-right : plan and staff them
    Rebuild search
    Offline mode
  quadrant "Fill-ins" bottom-left : when there's slack
    Tidy settings page
  quadrant "Money pits" bottom-right : avoid
    Custom theming engine
  Dark mode @ 0.35,0.62
  SSO for enterprise @ 0.8,0.6`,
  },
  parse: parseMatrix,
  render: renderMatrix,
}
