import { roundedRect } from '../../core/geometry.ts'
import { type Diagnostic, readLines } from '../../core/parse.ts'
import { g, h, n } from '../../core/svg.ts'
import { balance } from '../../core/text.ts'
import type { Context, DiagramType, Drawing, Parsed } from '../../core/types.ts'
import { corner, mix, OUTLINE, WEIGHT } from '../../theme/index.ts'
import {
  Bounds,
  blockHeight,
  frame,
  type Item,
  poles,
  readHead,
  readItem,
  sayer,
  tone,
  uid,
} from './common.ts'

/**
 * Items placed along a continuum between two poles:
 *
 *   spectrum "Leadership styles" Control .. Autonomy
 *     Directive : tells people what to do
 *     Coaching @ 0.45
 *     Delegating : hands over the decision
 *
 * Items spread evenly in the order written unless one gives `@ 0.3` (0 is the left pole). The
 * poles can also go on their own line: `Control .. Autonomy`.
 */
export interface SpectrumModel {
  title: string
  poles: [string, string]
  items: Item[]
}

export function parseSpectrum(source: string): Parsed<SpectrumModel> {
  const [first, ...rest] = readLines(source)
  const head = readHead(first)
  const diagnostics: Diagnostic[] = []
  let title = head.title
  let ends = head.rest ? poles(head.rest) : null
  if (!ends && !head.rest && poles(head.title)) {
    ends = poles(head.title)
    title = ''
  }
  const lines = [...rest]
  const poleLine = lines.findIndex((l) => /^(poles?\s+)?\S.*\s(\.\.+|->|-->|↔)\s.*\S$/.test(l.text))
  if (!ends && poleLine >= 0) {
    ends = poles(lines[poleLine].text.replace(/^poles?\s+/, ''))
    lines.splice(poleLine, 1)
  }
  if (!ends)
    diagnostics.push({
      line: head.line,
      message: 'Name the two poles after the title: `spectrum "Title" Control .. Autonomy`.',
      severity: 'error',
    })
  const items = lines.map((line) => readItem(line, { positions: true }))
  if (!items.length)
    diagnostics.push({
      line: head.line,
      message: 'Add items along the spectrum, one per indented line.',
      severity: 'warning',
    })
  return {
    model: ends ? { title, poles: ends, items } : null,
    diagnostics,
  }
}

const BAR = 10
const CARD_MAX = 170

interface Card {
  item: Item
  t: number
  x: number
  color: string
  ink: string
  lines: string[]
  note: string[]
  w: number
  h: number
  lane: number
  left: number
}

function measureCards({
  model,
  ctx,
  width,
}: {
  model: SpectrumModel
  ctx: Context
  width: number
}) {
  const { tokens, text: kit } = ctx
  const left = pick({ ctx, index: 2 })
  const right = pick({ ctx, index: 0 })
  const count = model.items.length
  const style = { size: 14, weight: WEIGHT.body }
  return model.items
    .map((item, i): Card => {
      const t = item.at?.[0] ?? (i + 1) / (count + 1)
      const lines = balance({ kit, text: item.label, style, max: CARD_MAX - 24 })
      const note = item.note ? kit.wrap(item.note, { size: 12.5, max: CARD_MAX + 10 }) : []
      const textW = Math.max(
        ...lines.map((l) => kit.width(l, style)),
        ...note.map((l) => kit.width(l, { size: 12.5 })),
      )
      const own = item.color ? tone({ tokens, color: item.color, index: i }) : null
      return {
        item,
        t,
        x: t * width,
        color: own?.stroke ?? mix({ from: left.stroke, to: right.stroke, amount: t }),
        ink: own?.strong ?? mix({ from: left.strong, to: right.strong, amount: t }),
        lines,
        note,
        w: textW + 24,
        h:
          blockHeight({ kit, count: lines.length, size: 14 }) +
          (note.length ? 4 + blockHeight({ kit, count: note.length, size: 12.5 }) : 0) +
          18,
        lane: 0,
        left: 0,
      }
    })
    .sort((a, b) => a.x - b.x)
}

function pick({ ctx, index }: { ctx: Context; index: number }) {
  return tone({ tokens: ctx.tokens, index })
}

/**
 * Even lanes sit above the bar and odd lanes below. Cards alternate sides, each taking the
 * nearest lane on its side (or the other) that it fits in.
 */
function assignLanes({ cards, width }: { cards: Card[]; width: number }): void {
  const ends: number[] = []
  cards.forEach((card, i) => {
    card.left = Math.max(-30, Math.min(width + 30 - card.w, card.x - card.w / 2))
    let k = 0
    while (ends[k ^ (i % 2)] !== undefined && ends[k ^ (i % 2)] + 12 > card.left) k++
    const lane = k ^ (i % 2)
    ends[lane] = card.left + card.w
    card.lane = lane
  })
}

export function renderSpectrum(model: SpectrumModel, ctx: Context): Drawing {
  const { tokens, text: kit } = ctx
  const say = sayer(kit)
  const width = Math.max(600, Math.min(940, model.items.length * 140))
  const cards = measureCards({ model, ctx, width })
  assignLanes({ cards, width })
  const laneH: number[] = []
  for (const c of cards) laneH[c.lane] = Math.max(laneH[c.lane] ?? 0, c.h)
  const offset = (lane: number) => {
    let y = 30
    for (let k = lane % 2; k < lane; k += 2) y += (laneH[k] ?? 0) + 14
    return y
  }
  const bounds = new Bounds()
  const left = pick({ ctx, index: 2 })
  const right = pick({ ctx, index: 0 })
  const id = uid({ ctx, prefix: 'mm-spectrum' })
  const defs = h(
    'linearGradient',
    { id, x1: 0, y1: 0, x2: 1, y2: 0 },
    h('stop', { offset: 0, 'stop-color': left.stroke }),
    h('stop', { offset: 1, 'stop-color': right.stroke }),
  )
  const poleStyle = { size: 17, weight: WEIGHT.heading }
  const parts: string[] = [
    h('path', {
      d: roundedRect({ x: 0, y: -BAR / 2, w: width, h: BAR, r: corner({ tokens, r: BAR / 2 }) }),
      fill: `url(#${id})`,
    }),
    say({ x: -18, y: 0, lines: [model.poles[0]], ...poleStyle, fill: tokens.fg, anchor: 'end' }),
    say({
      x: width + 18,
      y: 0,
      lines: [model.poles[1]],
      ...poleStyle,
      fill: tokens.fg,
      anchor: 'start',
    }),
  ]
  bounds.addText({ kit, x: -18, y: 0, lines: [model.poles[0]], ...poleStyle, anchor: 'end' })
  bounds.addText({
    kit,
    x: width + 18,
    y: 0,
    lines: [model.poles[1]],
    ...poleStyle,
    anchor: 'start',
  })
  bounds.add({ x: 0, y: -20, w: width, h: 40 })
  for (let k = 0; k <= 10; k++)
    parts.push(
      h('path', {
        d: `M${n((k / 10) * width)} ${n(BAR / 2 + 4)}v${k % 5 ? 4 : 8}`,
        stroke: tokens.faint,
        'stroke-width': 1,
      }),
    )
  for (const card of cards) {
    const above = card.lane % 2 === 0
    const edge = offset(card.lane)
    const top = above ? -edge - card.h : edge
    bounds.add({ x: card.left, y: top, w: card.w, h: card.h })
    parts.push(cardMarkup({ ctx, card, top, above }))
  }
  return frame({ ctx, title: model.title, body: g({}, ...parts), bounds, defs })
}

function cardMarkup({
  ctx,
  card,
  top,
  above,
}: {
  ctx: Context
  card: Card
  top: number
  above: boolean
}): string {
  const { tokens, text: kit } = ctx
  const say = sayer(kit)
  const stemFrom = above ? -BAR / 2 - 6 : BAR / 2 + 6
  const stemTo = above ? top + card.h : top
  const labelH = blockHeight({ kit, count: card.lines.length, size: 14 })
  const noteH = blockHeight({ kit, count: card.note.length, size: 12.5 })
  const cx = card.left + card.w / 2
  return g(
    {},
    h('path', {
      d: `M${n(card.x)} ${n(stemFrom)}V${n(stemTo)}`,
      stroke: card.color,
      'stroke-width': 1.5,
    }),
    h('circle', {
      cx: card.x,
      cy: 0,
      r: 8,
      fill: tokens.surface,
      stroke: card.ink,
      'stroke-width': 3,
    }),
    h('path', {
      d: roundedRect({
        x: card.left,
        y: top,
        w: card.w,
        h: card.h,
        r: corner({ tokens, r: 10 }),
      }),
      fill: tokens.surface,
      stroke: card.color,
      'stroke-width': OUTLINE.thin,
      filter: 'url(#mm-shadow)',
    }),
    say({
      x: cx,
      y: top + 9 + labelH / 2,
      lines: card.lines,
      size: 14,
      weight: WEIGHT.body,
      fill: tokens.fg,
    }),
    noteH
      ? say({
          x: cx,
          y: top + 9 + labelH + 4 + noteH / 2,
          lines: card.note,
          size: 12.5,
          fill: tokens.muted,
        })
      : '',
  )
}

export const spectrum: DiagramType<SpectrumModel> = {
  id: 'spectrum',
  keywords: ['spectrum', 'continuum'],
  title: 'Spectrum',
  summary: 'Items placed along a continuum between two poles, in order or at `@ 0.3`.',
  guide: {
    useWhen: 'options differ by degree along one dimension between two opposite poles.',
    syntax: `
The two poles on the header, then one item per line:

\`\`\`
spectrum "Title" Control .. Autonomy    %% left pole .. right pole
  Directive : tells people what to do   %% an item, with a note under it
  Coaching @ 0.45                       %% an item pinned to a position
  Delegating #green                     %% an item with its own color
\`\`\`

- **Poles** go after the quoted title: \`Left .. Right\`. The separator can be \`..\`, \`->\`,
  \`-->\`, \`<->\`, \`→\` or \`↔\`. Without poles the source is an error.
- **Quote the title.** Unquoted, the whole header is read as the poles:
  \`spectrum Leadership Control .. Autonomy\` gives the poles "Leadership Control" and
  "Autonomy", and no title.
- The poles can go on their own line instead: \`Control .. Autonomy\` or
  \`poles Control .. Autonomy\`. On that line the separator needs a space on each side and must
  be \`..\`, \`->\`, \`-->\` or \`↔\`. It's only looked for when the header has no poles, and the
  first matching line is taken, so then keep \` .. \` and \` -> \` out of item names.
- **Items** are all the other lines. Indentation doesn't matter: a nested line is just another
  item.
- **Position:** items without \`@\` spread evenly in the order written; item k of n sits at
  k/(n+1). \`@ 0.3\` pins an item: 0 is the left pole, 1 the right. Pinned items still count in
  n and keep their place k in the order, so the others don't move up to fill the gap, and a
  pinned item can land on top of one. Pin all items, or none, to be sure nothing overlaps. Cards alternate
  above and below the bar and stack when they crowd.
- **Colors:** an item's color blends from the left pole's to the right pole's by position.
  \`#color\` overrides it with a name (\`red\`, \`coral\`, \`orange\`, \`amber\`, \`yellow\`, \`lime\`,
  \`green\`, \`moss\`, \`teal\`, \`cyan\`, \`sky\`, \`blue\`, \`indigo\`, \`violet\`, \`purple\`,
  \`magenta\`, \`pink\`, \`rose\`, \`brown\`, \`grey\`) or a hex value like \`#e4572e\`.
- No items gives a warning.
- **Text:** a colon followed by a space starts the note, except inside quotes:
  \`"Plan: Pro" : yearly\`. At the end of a line, a \`#color\` (palette name or hex), \`!word\` or
  \`key=value\` is read as an option and taken out of the text; any other \`#word\`, like
  \`Ship #launch\`, stays in it. Quote a label to keep a trailing \`!word\` or \`key=value\`.
  \`@ 0.3\` is read only as the last thing on the line, so \`Meet @ 3pm\` stays text.`,
    example: `
spectrum "Situational leadership" Control .. Autonomy
  Directing : leader decides and explains
  Coaching : leader decides, invites ideas
  Supporting : team decides, leader helps
  Delegating : team owns the decision
  Laissez-faire @ 0.97`,
  },
  parse: parseSpectrum,
  render: renderSpectrum,
}
