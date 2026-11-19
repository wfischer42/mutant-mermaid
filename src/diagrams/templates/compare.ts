import { arrowHead, roundedRect } from '../../core/geometry.ts'
import { type Diagnostic, indentTree, readLines } from '../../core/parse.ts'
import { g, h, n } from '../../core/svg.ts'
import type { Context, DiagramType, Drawing, Parsed } from '../../core/types.ts'
import { corner, OUTLINE, type Swatch, type Tokens, WEIGHT } from '../../theme/index.ts'
import {
  Bounds,
  blockHeight,
  frame,
  type Item,
  NOTE,
  readHead,
  readItem,
  sayer,
  tone,
  wash,
} from './common.ts'

/**
 * Two to four columns side by side, with an arrow from each to the next:
 *
 *   before-after "Moving to trunk-based development"
 *     Before
 *       Long-lived branches
 *       Painful merges
 *     After
 *       Small daily merges
 *       Conflicts caught early
 *
 * When every column has the same number of items they line up as rows, with a small arrow
 * between each pair (`rows=false` turns that off). `style=vs` puts a "vs" badge between
 * columns instead of arrows. `before-after` greys the first column and greens the last.
 */
export interface Column extends Item {
  items: Item[]
}

export interface CompareModel {
  title: string
  columns: Column[]
  rows: boolean
  style: 'arrow' | 'vs'
  beforeAfter: boolean
}

export function parseCompare(source: string): Parsed<CompareModel> {
  const [first, ...rest] = readLines(source)
  const head = readHead(first)
  const diagnostics: Diagnostic[] = []
  const columns = indentTree(rest).map((node) => ({
    ...readItem(node.line),
    items: node.children.map((child) => readItem(child.line)),
  }))
  if (columns.length < 2)
    diagnostics.push({
      line: head.line,
      message: 'A comparison needs at least two columns, each with its items indented under it.',
      severity: 'error',
    })
  if (columns.length > 4)
    diagnostics.push({
      line: columns[4].line,
      message: 'A comparison reads best with two or three columns.',
      severity: 'warning',
    })
  const even = columns.every((c) => c.items.length === columns[0]?.items.length)
  const rowsAttr = head.attrs.rows
  const rows = head.flags.has('rows') || (rowsAttr ? rowsAttr !== 'false' : even)
  const style = head.attrs.style === 'vs' || head.keyword === 'versus' ? 'vs' : 'arrow'
  return {
    model: {
      title: head.title,
      columns,
      rows,
      style,
      beforeAfter: head.keyword === 'before-after' || head.keyword === 'beforeafter',
    },
    diagnostics,
  }
}

function columnSwatch({
  tokens,
  model,
  index,
}: {
  tokens: Tokens
  model: CompareModel
  index: number
}): Swatch {
  const column = model.columns[index]
  if (column.color || !model.beforeAfter) return tone({ tokens, color: column.color, index })
  if (index === 0) return tokens.semantic.neutral
  if (index === model.columns.length - 1) return tokens.semantic.positive
  return tokens.semantic.balancing
}

const PAD = 16
const GUTTER = 64
const ITEM_GAP = 10
const LABEL_SIZE = 14

interface Cell {
  lines: string[]
  note: string[]
  h: number
}

interface Laid {
  swatch: Swatch
  heading: string[]
  note: string[]
  cells: Cell[]
  tops: number[]
}

function measureCell({ ctx, item, width }: { ctx: Context; item: Item; width: number }): Cell {
  const kit = ctx.text
  const lines = kit.wrap(item.label, { size: LABEL_SIZE, weight: WEIGHT.body, max: width - 40 })
  const note = item.note ? kit.wrap(item.note, { size: 12.5, max: width - 40 }) : []
  const textH =
    blockHeight({ kit, count: lines.length, size: LABEL_SIZE }) +
    (note.length ? 4 + blockHeight({ kit, count: note.length, size: 12.5 }) : 0)
  return { lines, note, h: textH + 22 }
}

/** Sizes every column, then sets item tops: shared row heights when rows line up. */
function layout({ model, ctx, width }: { model: CompareModel; ctx: Context; width: number }) {
  const kit = ctx.text
  const laid: Laid[] = model.columns.map((column, index) => ({
    swatch: columnSwatch({ tokens: ctx.tokens, model, index }),
    heading: kit.wrap(column.label, { size: 18, weight: WEIGHT.heading, max: width - PAD * 2 }),
    note: column.note ? kit.wrap(column.note, { size: NOTE, max: width - PAD * 2 }) : [],
    cells: column.items.map((item) => measureCell({ ctx, item, width: width - PAD * 2 })),
    tops: [],
  }))
  const headH = Math.max(
    ...laid.map(
      (c) =>
        blockHeight({ kit, count: c.heading.length, size: 18 }) +
        (c.note.length ? 4 + blockHeight({ kit, count: c.note.length, size: NOTE }) : 0),
    ),
  )
  const start = PAD + headH + 18
  const count = Math.max(...laid.map((c) => c.cells.length))
  const rowH = Array.from({ length: count }, (_, i) =>
    Math.max(0, ...laid.map((c) => c.cells[i]?.h ?? 0)),
  )
  for (const column of laid) {
    let y = start
    column.cells.forEach((cell, i) => {
      if (model.rows) cell.h = rowH[i]
      column.tops.push(y)
      y += cell.h + ITEM_GAP
    })
  }
  const bottom = Math.max(
    start + 20,
    ...laid.map((c) =>
      c.cells.length ? c.tops[c.tops.length - 1] + c.cells[c.cells.length - 1].h : start,
    ),
  )
  return { laid, headH, start, height: bottom + PAD, rowH }
}

export function renderCompare(model: CompareModel, ctx: Context): Drawing {
  const width = model.columns.length > 2 ? 250 : 290
  const { laid, headH, start, height } = layout({ model, ctx, width })
  const bounds = new Bounds()
  const xs = laid.map((_, i) => i * (width + GUTTER))
  bounds.add({ x: 0, y: 0, w: xs[xs.length - 1] + width, h: height })
  const panels = laid.map((column, i) => panel({ ctx, column, x: xs[i], width, height, headH }))
  const links = laid
    .slice(1)
    .map((next, i) =>
      between({ ctx, model, from: laid[i], to: next, x: xs[i] + width, start, height }),
    )
  return frame({ ctx, title: model.title, body: g({}, ...panels, ...links), bounds })
}

function panel({
  ctx,
  column,
  x,
  width,
  height,
  headH,
}: {
  ctx: Context
  column: Laid
  x: number
  width: number
  height: number
  headH: number
}): string {
  const { tokens, text: kit } = ctx
  const say = sayer(kit)
  const { swatch } = column
  const titleH = blockHeight({ kit, count: column.heading.length, size: 18 })
  const noteH = blockHeight({ kit, count: column.note.length, size: NOTE })
  const cells = column.cells.map((cell, i) => {
    const y = column.tops[i]
    const textH = cell.h - 22
    const lineH = blockHeight({ kit, count: cell.lines.length, size: LABEL_SIZE })
    const top = y + (cell.h - textH) / 2
    return g(
      {},
      h('path', {
        d: roundedRect({ x: PAD, y, w: width - PAD * 2, h: cell.h, r: corner({ tokens, r: 10 }) }),
        fill: tokens.surface,
        stroke: swatch.stroke,
        'stroke-opacity': 0.45,
        'stroke-width': 1,
      }),
      h('circle', { cx: PAD + 16, cy: top + LABEL_SIZE * 0.55, r: 3.5, fill: swatch.stroke }),
      say({
        x: PAD + 28,
        y: top + lineH / 2,
        lines: cell.lines,
        size: LABEL_SIZE,
        weight: WEIGHT.body,
        fill: tokens.fg,
        anchor: 'start',
      }),
      cell.note.length
        ? say({
            x: PAD + 28,
            y: top + lineH + 4 + blockHeight({ kit, count: cell.note.length, size: 12.5 }) / 2,
            lines: cell.note,
            size: 12.5,
            fill: tokens.muted,
            anchor: 'start',
          })
        : '',
    )
  })
  return g(
    { x },
    h('path', {
      d: roundedRect({ x: 0, y: 0, w: width, h: height, r: corner({ tokens, r: 16 }) }),
      fill: wash({ tokens, swatch }),
      stroke: swatch.stroke,
      'stroke-width': OUTLINE.thin,
    }),
    say({
      x: width / 2,
      y: PAD + titleH / 2 + 2,
      lines: column.heading,
      size: 18,
      weight: WEIGHT.heading,
      fill: tokens.fg,
    }),
    noteH
      ? say({
          x: width / 2,
          y: PAD + titleH + 6 + noteH / 2,
          lines: column.note,
          size: NOTE,
          fill: tokens.muted,
        })
      : '',
    h('path', {
      d: `M${PAD} ${n(PAD + headH + 9)}H${n(width - PAD)}`,
      stroke: swatch.stroke,
      'stroke-opacity': 0.4,
    }),
    ...cells,
  )
}

/** What sits between two columns: one arrow, an arrow per aligned row, or a "vs" badge. */
function between({
  ctx,
  model,
  from,
  to,
  x,
  start,
  height,
}: {
  ctx: Context
  model: CompareModel
  from: Laid
  to: Laid
  x: number
  start: number
  height: number
}): string {
  const { tokens } = ctx
  const cx = x + GUTTER / 2
  if (model.style === 'vs')
    return g(
      {},
      h('circle', {
        cx,
        cy: height / 2,
        r: 21,
        fill: tokens.surface,
        stroke: tokens.border,
        'stroke-width': OUTLINE.thin,
      }),
      sayer(ctx.text)({
        x: cx,
        y: height / 2,
        lines: ['vs'],
        size: 15,
        weight: WEIGHT.heading,
        fill: tokens.muted,
      }),
    )
  if (model.rows && from.cells.length)
    return g(
      {},
      ...from.cells.map((cell, i) =>
        arrow({ x, y: from.tops[i] + cell.h / 2, swatch: to.swatch, size: 'small' }),
      ),
    )
  const mid = (start + height) / 2
  return arrow({ x, y: mid, swatch: to.swatch, size: 'large' })
}

function arrow({
  x,
  y,
  swatch,
  size,
}: {
  x: number
  y: number
  swatch: Swatch
  size: 'small' | 'large'
}): string {
  const cx = x + GUTTER / 2
  if (size === 'small')
    return g(
      {},
      h('path', {
        d: `M${n(x + 10)} ${n(y)}H${n(x + GUTTER - 18)}`,
        stroke: swatch.stroke,
        'stroke-width': 2,
        'stroke-linecap': 'round',
      }),
      h('path', {
        d: arrowHead({ tip: { x: x + GUTTER - 9, y }, angle: 0, size: 10 }),
        fill: swatch.strong,
      }),
    )
  return g(
    {},
    h('circle', {
      cx,
      cy: y,
      r: 22,
      fill: swatch.fill,
      stroke: swatch.stroke,
      'stroke-width': 1.6,
    }),
    h('path', {
      d: `M${n(cx - 9)} ${n(y)}H${n(cx + 4)}`,
      stroke: swatch.strong,
      'stroke-width': 3,
      'stroke-linecap': 'round',
    }),
    h('path', {
      d: arrowHead({ tip: { x: cx + 11, y }, angle: 0, size: 11 }),
      fill: swatch.strong,
    }),
  )
}

export const compare: DiagramType<CompareModel> = {
  id: 'compare',
  keywords: ['compare', 'before-after', 'beforeafter', 'versus'],
  title: 'Compare',
  summary:
    'Two to four columns side by side with arrows between them; `before-after` greys the old and greens the new.',
  guide: {
    useWhen: 'two to four options or states sit side by side and the contrast is the point.',
    syntax: `
Columns unindented, their items indented under them:

\`\`\`
compare "Title" style=vs
  Postgres : relational            %% a column, with an optional note
    Strong consistency             %% an item in that column
    Rich SQL : joins and views     %% an item with a note under it
  DynamoDB #amber                  %% a column with its own color
    Scales without tuning
    Pay per request
\`\`\`

- **Columns** are the unindented lines, drawn left to right in the order written. Use 2 to 4.
  Fewer than 2 is an error; a fifth warns.
- **Items** are the lines indented under a column. An item's note shows under its label. An
  item's \`#color\` is ignored, and so are lines nested under it.
- **Keywords:** \`compare\` colors columns from the palette in order. \`before-after\` (or
  \`beforeafter\`) makes the first column grey, the last green and any middle ones blue; you
  still name the columns yourself ("Before", "After"). \`versus\` is \`compare\` with \`style=vs\`.
- **Between columns:** an arrow from each column to the next, so put the old or current state
  first. \`style=vs\` on the header puts a "vs" badge there instead. Any other \`style\` value is
  ignored.
- **Rows:** when every column has the same number of items, the items line up in rows: item 1
  of each column at one height, item 2 at the next. With arrows, each row gets its own small
  arrow; otherwise there's one large arrow per gap. \`rows=false\` on the header turns this off;
  \`!rows\` or \`rows=true\` turns it on. Any \`rows\` value other than \`false\` turns it on, even
  \`rows=no\`.
- **Colors:** \`#color\` on a column overrides its color. It takes a name (\`red\`, \`coral\`,
  \`orange\`, \`amber\`, \`yellow\`, \`lime\`, \`green\`, \`moss\`, \`teal\`, \`cyan\`, \`sky\`, \`blue\`,
  \`indigo\`, \`violet\`, \`purple\`, \`magenta\`, \`pink\`, \`rose\`, \`brown\`, \`grey\`) or a hex
  value like \`#e4572e\`.
- **Text:** a colon followed by a space starts the note, except inside quotes:
  \`"Plan: Pro" : yearly\`. At the end of a line, a \`#color\` (palette name or hex), \`!word\` or
  \`key=value\` is read as an option and taken out of the text; any other \`#word\`, like
  \`Ship #launch\`, stays in it. Quote a label to keep a trailing \`!word\` or \`key=value\`.`,
    example: `
before-after "Moving to trunk-based development"
  Before : long-lived feature branches
    Week-long branches
    Painful, risky merges : conflicts found at the end
    Big-bang releases
  After : small changes on main
    Daily merges behind flags
    Conflicts caught in minutes : CI runs on every push
    Ship whenever it's green`,
  },
  parse: parseCompare,
  render: renderCompare,
}
