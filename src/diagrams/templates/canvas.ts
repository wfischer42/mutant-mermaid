import { roundedRect } from '../../core/geometry.ts'
import { type Diagnostic, indentTree, readLines } from '../../core/parse.ts'
import { g, h, n } from '../../core/svg.ts'
import type { Context, DiagramType, Drawing, Parsed } from '../../core/types.ts'
import { corner, OUTLINE, type Swatch, type Tokens, WEIGHT } from '../../theme/index.ts'
import {
  Bounds,
  blockHeight,
  flow,
  frame,
  type Item,
  LABEL,
  NOTE,
  raised,
  readHead,
  readItem,
  sayer,
  tone,
  wash,
} from './common.ts'

/**
 * A grid of named regions holding sticky notes:
 *
 *   canvas "Lean canvas" cols=3
 *     Problem
 *       Onboarding takes weeks
 *     Solution : what we build
 *       Guided setup
 *     Channels span=2
 *       Partner referrals
 *
 * `swot` presets Strengths, Weaknesses, Opportunities and Threats with semantic colors; their
 * regions can be written in any order, or as S, W, O, T. `span=2` widens a region.
 */
export interface Region extends Item {
  items: Item[]
  span: number
}

export interface CanvasModel {
  title: string
  regions: Region[]
  cols: number
  swot: boolean
}

const SWOT = ['Strengths', 'Weaknesses', 'Opportunities', 'Threats']

/** The SWOT name a region label stands for, or null. */
function swotName(label: string): string | null {
  const key = label.trim().toLowerCase()
  return SWOT.find((name) => key.length > 0 && name.toLowerCase().startsWith(key)) ?? null
}

function order(label: string): number {
  const at = SWOT.indexOf(label)
  return at < 0 ? SWOT.length : at
}

export function parseCanvas(source: string): Parsed<CanvasModel> {
  const [first, ...rest] = readLines(source)
  const head = readHead(first)
  const diagnostics: Diagnostic[] = []
  const swot = head.keyword === 'swot'
  const regions: Region[] = indentTree(rest).map((node) => {
    const item = readItem(node.line)
    return {
      ...item,
      label: (swot && swotName(item.label)) || item.label,
      span: Math.max(1, Math.round(Number(item.attrs.span ?? 1)) || 1),
      items: node.children.map((child) => readItem(child.line)),
    }
  })
  const missing = swot ? SWOT.filter((name) => !regions.some((r) => r.label === name)) : []
  for (const label of missing)
    regions.push({ label, attrs: {}, flags: new Set(), items: [], span: 1, line: head.line })
  if (swot) regions.sort((a, b) => order(a.label) - order(b.label))
  if (!regions.length)
    diagnostics.push({
      line: head.line,
      message: 'A canvas needs regions: one per line, with its notes indented under it.',
      severity: 'error',
    })
  const auto = regions.length <= 4 && regions.length !== 3 ? 2 : 3
  const cols = Math.max(1, Number(head.attrs.cols) || (regions.length === 1 ? 1 : auto))
  return { model: { title: head.title, regions, cols, swot }, diagnostics }
}

/** Semantic colors for the SWOT regions; categorical ones for any other canvas. */
function regionSwatch({
  tokens,
  region,
  index,
  swot,
}: {
  tokens: Tokens
  region: Region
  index: number
  swot: boolean
}): Swatch {
  if (region.color || !swot) return tone({ tokens, color: region.color, index })
  const preset: Record<string, Swatch> = {
    Strengths: tokens.semantic.positive,
    Weaknesses: tokens.semantic.caution,
    Opportunities: tokens.semantic.balancing,
    Threats: tokens.semantic.negative,
  }
  return preset[region.label] ?? tone({ tokens, index })
}

const GAP = 16
const PAD = 16
const NOTE_GAP = 10

interface Sticky {
  lines: string[]
  x: number
  y: number
  w: number
  h: number
}

interface Card {
  region: Region
  swatch: Swatch
  x: number
  y: number
  w: number
  h: number
  heading: string[]
  note: string[]
  stickies: Sticky[]
}

function regionWidth(cols: number): number {
  if (cols <= 2) return 320
  if (cols === 3) return 260
  return 220
}

/** Sizes each region and its notes, before rows are known. */
function measure({ model, ctx }: { model: CanvasModel; ctx: Context }): Card[] {
  const kit = ctx.text
  const unit = regionWidth(model.cols)
  return model.regions.map((region, index) => {
    const span = Math.min(region.span, model.cols)
    const w = unit * span + GAP * (span - 1)
    const inner = w - PAD * 2
    const perRow = Math.max(2, Math.floor((inner + NOTE_GAP) / 130))
    const noteW = (inner - NOTE_GAP * (perRow - 1)) / perRow
    const sized = region.items.map((item) => {
      const lines = kit.wrap(item.label, { size: 13, weight: WEIGHT.body, max: noteW - 18 })
      const height = blockHeight({ kit, count: lines.length, size: 13 }) + 26
      return { lines, w: noteW, h: Math.max(58, height) }
    })
    const packed = flow({ sizes: sized, max: inner, gap: NOTE_GAP })
    const heading = kit.wrap(region.label, {
      size: LABEL + 1,
      weight: WEIGHT.heading,
      max: inner - 30,
    })
    const note = region.note ? kit.wrap(region.note, { size: NOTE, max: inner }) : []
    const noteH = note.length ? 4 + blockHeight({ kit, count: note.length, size: NOTE }) : 0
    const top = PAD + 6 + blockHeight({ kit, count: heading.length, size: LABEL + 1 }) + noteH + 14
    return {
      region,
      swatch: regionSwatch({ tokens: ctx.tokens, region, index, swot: model.swot }),
      x: 0,
      y: 0,
      w,
      h: Math.max(model.swot ? 170 : 130, top + packed.h + PAD),
      heading,
      note,
      stickies: sized.map((s, i) => ({ ...s, x: PAD + packed.at[i].x, y: top + packed.at[i].y })),
    }
  })
}

/** Places regions left to right in rows of `cols` units; every region in a row shares its height. */
function place({ model, ctx }: { model: CanvasModel; ctx: Context }): Card[] {
  const rows: Card[][] = []
  let used = model.cols
  for (const card of measure({ model, ctx })) {
    const span = Math.min(card.region.span, model.cols)
    if (used + span > model.cols) {
      rows.push([])
      used = 0
    }
    rows[rows.length - 1].push(card)
    used += span
  }
  const cards: Card[] = []
  let y = 0
  for (const row of rows) {
    const height = Math.max(...row.map((c) => c.h))
    let x = 0
    for (const card of row) {
      cards.push({ ...card, x, y, h: height })
      x += card.w + GAP
    }
    y += height + GAP
  }
  return cards
}

export function renderCanvas(model: CanvasModel, ctx: Context): Drawing {
  const cards = place({ model, ctx })
  const bounds = new Bounds()
  for (const card of cards) bounds.add(card)
  const body = g({}, ...cards.map((card) => region({ ctx, card, model })))
  return frame({ ctx, title: model.title, body, bounds })
}

function region({ ctx, card, model }: { ctx: Context; card: Card; model: CanvasModel }): string {
  const { tokens, text: kit } = ctx
  const say = sayer(kit)
  const { swatch } = card
  const headH = blockHeight({ kit, count: card.heading.length, size: LABEL + 1 })
  const noteH = blockHeight({ kit, count: card.note.length, size: NOTE })
  const letter = model.swot
    ? say({
        x: card.w - PAD,
        y: PAD + 12,
        lines: [card.region.label[0]],
        size: 40,
        weight: WEIGHT.heading,
        fill: swatch.soft,
        anchor: 'end',
      })
    : ''
  const topBar = model.swot
    ? ''
    : h('path', {
        d: `M14 1.5H${n(card.w - 14)}`,
        stroke: swatch.stroke,
        'stroke-width': 3,
        'stroke-linecap': 'round',
      })
  return g(
    { x: card.x, y: card.y },
    h('path', {
      d: roundedRect({ x: 0, y: 0, w: card.w, h: card.h, r: corner({ tokens, r: 14 }) }),
      fill: model.swot ? wash({ tokens, swatch }) : tokens.surface,
      stroke: model.swot ? swatch.stroke : tokens.border,
      'stroke-width': OUTLINE.thin,
    }),
    topBar,
    letter,
    say({
      x: PAD,
      y: PAD + 6 + headH / 2,
      lines: card.heading,
      size: LABEL + 1,
      weight: WEIGHT.heading,
      fill: tokens.fg,
      anchor: 'start',
    }),
    noteH
      ? say({
          x: PAD,
          y: PAD + 10 + headH + noteH / 2,
          lines: card.note,
          size: NOTE,
          fill: tokens.muted,
          anchor: 'start',
        })
      : '',
    ...card.stickies.map((s) => sticky({ ctx, swatch, note: s, swot: model.swot })),
  )
}

/** A sticky note's outline: square corners, rounded by `k`, with the bottom-right folded. */
function stickyPath({ note, fold, k }: { note: Sticky; fold: number; k: number }): string {
  const { x, y, w, h: height } = note
  const r = x + w
  const b = y + height
  return (
    `M${n(x + k)} ${n(y)}H${n(r - k)}Q${n(r)} ${n(y)} ${n(r)} ${n(y + k)}V${n(b - fold)}` +
    `L${n(r - fold)} ${n(b)}H${n(x + k)}Q${n(x)} ${n(b)} ${n(x)} ${n(b - k)}V${n(y + k)}` +
    `Q${n(x)} ${n(y)} ${n(x + k)} ${n(y)}Z`
  )
}

/** A sticky note with a folded corner; tilted a touch in the sketch look. */
function sticky({
  ctx,
  swatch,
  note,
  swot,
}: {
  ctx: Context
  swatch: Swatch
  note: Sticky
  swot: boolean
}): string {
  const { tokens } = ctx
  const fold = 12
  const tilt = tokens.look === 'sketch' ? ctx.rng.range({ min: -2, max: 2 }) : 0
  const cx = note.x + note.w / 2
  const cy = note.y + note.h / 2
  const r = note.x + note.w
  const b = note.y + note.h
  return g(
    { transform: tilt ? `rotate(${n(tilt)} ${n(cx)} ${n(cy)})` : undefined },
    h('path', {
      d: stickyPath({ note, fold, k: corner({ tokens, r: 3 }) }),
      fill: swot ? tokens.surface : raised(tokens),
      filter: 'url(#mm-shadow)',
    }),
    h('path', {
      d: `M${n(r)} ${n(b - fold)}L${n(r - fold)} ${n(b)}L${n(r - fold + 1.5)} ${n(b - fold + 1.5)}Z`,
      fill: swatch.stroke,
      'fill-opacity': 0.6,
    }),
    sayer(ctx.text)({
      x: cx,
      y: cy,
      lines: note.lines,
      size: 13,
      weight: WEIGHT.body,
      fill: tokens.fg,
    }),
  )
}

export const canvas: DiagramType<CanvasModel> = {
  id: 'canvas',
  keywords: ['canvas', 'swot'],
  title: 'Canvas',
  summary:
    'A grid of named regions with sticky-note items; `swot` presets Strengths, Weaknesses, Opportunities and Threats.',
  guide: {
    useWhen: 'ideas sort into a set of named boxes, like a lean canvas or a SWOT.',
    syntax: `
Regions unindented, their sticky notes indented under them:

\`\`\`
canvas "Title" cols=3
  Problem : top three pains        %% a region, with an optional note
    Onboarding takes weeks         %% a sticky note in that region
  Solution #green                  %% a region with its own color
    Guided setup
  Costs span=2                     %% a region two columns wide
\`\`\`

- **Regions** are the unindented lines. They fill the grid left to right, then down, in the
  order written. A region can be empty.
- **Sticky notes** are the lines indented under a region. Only the label shows: a sticky's note
  and \`#color\` are ignored, and so are lines nested under it.
- **\`cols=N\`** on the header sets the number of columns. Default: 1 region gives 1 column,
  2 or 4 give 2, and 3 or 5 and more give 3.
- **\`span=N\`** on a region makes it N columns wide, at most \`cols\`. A region that doesn't fit
  in what's left of a row starts the next row, leaving a gap. All regions in a row get the same
  height. Regions can't span rows.
- **Colors:** regions take palette colors in order. \`#color\` takes a name (\`red\`, \`coral\`,
  \`orange\`, \`amber\`, \`yellow\`, \`lime\`, \`green\`, \`moss\`, \`teal\`, \`cyan\`, \`sky\`, \`blue\`,
  \`indigo\`, \`violet\`, \`purple\`, \`magenta\`, \`pink\`, \`rose\`, \`brown\`, \`grey\`) or a hex
  value like \`#e4572e\`.
- **\`swot\`** instead of \`canvas\` gives the four SWOT regions in a 2×2, each with a fixed color
  and a large initial letter:
  - A region name matches Strengths, Weaknesses, Opportunities or Threats by any start of the
    word, any case (\`S\`, \`str\`, \`weak\`, \`Threats\`), and is shown in full.
  - The four are always drawn in S, W, O, T order, whatever order you write them in. Missing
    ones are drawn empty, so \`swot "Title"\` alone gives four empty boxes.
  - Any other name is an extra region after the four. An extra makes the default 3 columns;
    add \`cols=2\` to keep the 2×2 shape.
- **Text:** a colon followed by a space starts the note, except inside quotes:
  \`"Plan: Pro" : yearly\`. At the end of a line, a \`#color\` (palette name or hex), \`!word\` or
  \`key=value\` is read as an option and taken out of the text; any other \`#word\`, like
  \`Ship #launch\`, stays in it. Quote a label to keep a trailing \`!word\` or \`key=value\`.`,
    example: `
canvas "Lean canvas: team retro tool" cols=3
  Problem : top three pains
    Retros feel repetitive
    Action items get lost
  Solution
    Rotating formats
    Auto-tracked actions
  Unique value : why us
    Retros people look forward to
  Customers
    Engineering managers
    Agile coaches
  Channels
    Slack app directory
  Metrics
    Weekly active teams
    Actions closed
  Costs span=2
    Hosting
    Two engineers
  Revenue
    Per-team subscription`,
  },
  parse: parseCanvas,
  render: renderCanvas,
}
