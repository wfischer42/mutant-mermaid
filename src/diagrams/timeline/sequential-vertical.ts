import { roundedRect } from '../../core/geometry.ts'
import { target } from '../../core/hooks.ts'
import { h, n, text } from '../../core/svg.ts'
import { balance } from '../../core/text.ts'
import type { Context, Drawing } from '../../core/types.ts'
import { corner, OUTLINE, type Swatch, WEIGHT } from '../../theme/index.ts'
import {
  CARD_GAP,
  CARD_PAD,
  cardHeight,
  cardShape,
  type Group,
  groupsOf,
  MARGIN,
  SIZES,
} from './sequential.ts'
import { periodIds, type SequentialTimeline } from './syntax.ts'

/**
 * Mermaid's timeline running down the page: periods are pills on a vertical spine, their events
 * flow to the right as cards (wrapping onto further rows when there are many), and sections
 * become tinted bands with a header across the top.
 */

const PERIOD_GAP = 16
const SECTION_GAP = 18
const SECTION_HEAD = 44
const CARD_MAX = 200
const ROW_MAX = 680
const PILL_MAX = 150
const PERIOD_STYLE = { size: SIZES.period, weight: WEIGHT.heading }
const EVENT_STYLE = { size: SIZES.event, weight: WEIGHT.body }

interface Card {
  x: number
  y: number
  w: number
  h: number
  lines: string[]
}

interface Row {
  pill: string[]
  pillTop: number
  pillHeight: number
  cards: Card[]
  bottom: number
  swatch: Swatch
  /** The period's id and its events' ids, for the host app. */
  ids: { id: string; events: string[] }
}

interface Band {
  group: Group
  top: number
  bottom: number
}

interface Plan {
  spine: number
  pillWidth: number
  cardsLeft: number
  rows: Row[]
  bands: Band[]
  right: number
  bottom: number
}

/** Cards flowed left to right from `left`, onto a new row past ROW_MAX; tops relative to 0. */
function flowCards({ events, ctx, left }: { events: string[]; ctx: Context; left: number }) {
  const lh = ctx.text.lineHeight({ size: SIZES.event })
  const cards: Card[] = []
  let x = left
  let y = 0
  let rowHeight = 0
  for (const event of events) {
    const lines = ctx.text.wrap(event, { ...EVENT_STYLE, max: CARD_MAX })
    const w = Math.max(...lines.map((l) => ctx.text.width(l, EVENT_STYLE))) + CARD_PAD * 2
    const hh = cardHeight({ lines, lineHeight: lh })
    if (x > left && x + w > left + ROW_MAX) {
      x = left
      y += rowHeight + CARD_GAP
      rowHeight = 0
    }
    cards.push({ x, y, w, h: hh, lines })
    x += w + CARD_GAP
    rowHeight = Math.max(rowHeight, hh)
  }
  return { cards, height: y + rowHeight, firstRow: cards.filter((c) => c.y === 0) }
}

function pillsOf({ model, ctx }: { model: SequentialTimeline; ctx: Context }) {
  const pills = model.periods.map((p) =>
    balance({ kit: ctx.text, text: p.label, style: PERIOD_STYLE, max: PILL_MAX }),
  )
  const width = Math.max(...pills.flat().map((line) => ctx.text.width(line, PERIOD_STYLE)), 40) + 30
  return { pills, width }
}

/** One period's row: the pill centred against the first row of cards. */
function placeRow({
  ctx,
  pill,
  events,
  top,
  left,
  swatch,
}: {
  ctx: Context
  pill: string[]
  events: string[]
  top: number
  left: number
  swatch: Swatch
}): Omit<Row, 'ids'> {
  const pillHeight = pill.length * ctx.text.lineHeight({ size: SIZES.period }) + 16
  const flow = flowCards({ events, ctx, left })
  const first = Math.max(0, ...flow.firstRow.map((c) => c.h))
  const cardsTop = top + Math.max(0, (pillHeight - first) / 2)
  const pillTop = top + Math.max(0, (first - pillHeight) / 2)
  const cards = flow.cards.map((c) => ({ ...c, y: c.y + cardsTop }))
  const bottom = Math.max(pillTop + pillHeight, cardsTop + flow.height)
  return { pill, pillTop, pillHeight, cards, bottom, swatch }
}

function plan({ model, ctx }: { model: SequentialTimeline; ctx: Context }): Plan {
  const sectioned = model.sections.length > 0
  const groups = groupsOf({ model, ctx })
  const { pills, width } = pillsOf({ model, ctx })
  const spine = MARGIN + (sectioned ? 16 : 0) + width / 2
  const cardsLeft = spine + width / 2 + 28
  const rows: Row[] = []
  const bands: Band[] = []
  const ids = periodIds(model)
  let y = MARGIN + (model.title ? 52 : 0)
  for (const group of groups) {
    const top = y
    if (sectioned) y += SECTION_HEAD
    for (let i = group.first; i <= group.last; i++) {
      const row = placeRow({
        ctx,
        pill: pills[i],
        events: model.periods[i].events,
        top: y,
        left: cardsLeft,
        swatch: group.swatch,
      })
      rows.push({ ...row, ids: ids.get(model.periods[i]) ?? { id: '', events: [] } })
      y = row.bottom + PERIOD_GAP
    }
    bands.push({ group, top, bottom: y - PERIOD_GAP + 12 })
    if (sectioned) y += SECTION_GAP
  }
  const right = Math.max(cardsLeft + 120, ...rows.flatMap((r) => r.cards.map((c) => c.x + c.w)))
  return { spine, pillWidth: width, cardsLeft, rows, bands, right, bottom: y }
}

function drawBands({ ctx, layout }: { ctx: Context; layout: Plan }): string[] {
  const w = layout.right + 16 - MARGIN
  return layout.bands.map(({ group, top, bottom }) =>
    h('path', {
      d: roundedRect({
        x: MARGIN,
        y: top,
        w,
        h: bottom - top,
        r: corner({ tokens: ctx.tokens, r: 14 }),
      }),
      fill: group.swatch.fill,
      opacity: ctx.tokens.dark ? 0.7 : 1,
    }),
  )
}

/** Section names, drawn over the spine where it passes from one band to the next. */
function drawBandHeads({ ctx, layout }: { ctx: Context; layout: Plan }): string[] {
  const x = MARGIN
  const w = layout.right + 16 - x
  return layout.bands.map(({ group, top }) =>
    [
      h('path', {
        d: roundedRect({
          x: x + 6,
          y: top + 6,
          w: w - 12,
          h: 28,
          r: corner({ tokens: ctx.tokens, r: 9 }),
        }),
        fill: group.swatch.soft,
      }),
      text({
        x: x + 18,
        y: top + 20,
        lines: [
          ctx.text.wrap(group.label, {
            size: SIZES.section,
            weight: WEIGHT.heading,
            max: w - 36,
          })[0] ?? '',
        ],
        size: SIZES.section,
        weight: WEIGHT.heading,
        fill: group.swatch.ink,
        anchor: 'start',
        lineHeight: 0,
        shift: ctx.text.baselineShift({ size: SIZES.section }),
      }),
    ].join(''),
  )
}

function drawSpine({ ctx, layout }: { ctx: Context; layout: Plan }): string {
  const first = layout.rows[0]
  const last = layout.rows[layout.rows.length - 1]
  const x = layout.spine
  const y0 = first.pillTop - 6
  const y1 = last.bottom + 14
  const style = { stroke: ctx.tokens.faint, 'stroke-width': 2.5, 'stroke-linecap': 'round' }
  return (
    h('path', { d: `M${n(x)} ${n(y0)}V${n(y1)}`, ...style }) +
    h('path', {
      d: `M${n(x - 6)} ${n(y1 - 7)}L${n(x)} ${n(y1 + 1)}L${n(x + 6)} ${n(y1 - 7)}`,
      ...style,
      'stroke-linejoin': 'round',
      fill: 'none',
    })
  )
}

function drawCards({ ctx, row, sectioned }: { ctx: Context; row: Row; sectioned: boolean }) {
  const lh = ctx.text.lineHeight({ size: SIZES.event })
  return row.cards.map((c, i) =>
    h(
      'g',
      target({ id: row.ids.events[i] ?? '', kind: 'event', tint: row.swatch.stroke }),
      h('path', {
        d: cardShape({ ctx, x: c.x, y: c.y, w: c.w, hh: c.h }),
        fill: sectioned ? ctx.tokens.surface : row.swatch.fill,
        stroke: row.swatch.soft,
        'stroke-width': OUTLINE.thin,
        filter: 'url(#mm-shadow)',
      }),
      text({
        x: c.x + c.w / 2,
        y: c.y + c.h / 2,
        lines: c.lines,
        ...EVENT_STYLE,
        fill: row.swatch.ink,
        lineHeight: lh,
        shift: ctx.text.baselineShift({ size: SIZES.event }),
      }),
    ),
  )
}

function drawRow({
  ctx,
  layout,
  row,
  sectioned,
}: {
  ctx: Context
  layout: Plan
  row: Row
  sectioned: boolean
}): string {
  const { tokens } = ctx
  const mid = row.pillTop + row.pillHeight / 2
  const widest = Math.max(...row.pill.map((l) => ctx.text.width(l, PERIOD_STYLE)))
  const w = Math.min(layout.pillWidth, widest + 30)
  const stem = row.cards.length
    ? h('path', {
        d: `M${n(layout.spine)} ${n(mid)}H${n(layout.cardsLeft)}`,
        stroke: row.swatch.stroke,
        'stroke-width': 1.5,
      })
    : ''
  const pill = h('path', {
    d: roundedRect({
      x: layout.spine - w / 2,
      y: row.pillTop,
      w,
      h: row.pillHeight,
      r: corner({ tokens, r: row.pillHeight / 2 }),
    }),
    fill: row.swatch.strong,
    stroke: tokens.bg,
    'stroke-width': 3,
  })
  const name = text({
    x: layout.spine,
    y: mid,
    lines: row.pill,
    ...PERIOD_STYLE,
    fill: tokens.bg,
    lineHeight: ctx.text.lineHeight({ size: SIZES.period }),
    shift: ctx.text.baselineShift({ size: SIZES.period }),
  })
  const period = h(
    'g',
    target({ id: row.ids.id, kind: 'period', tint: row.swatch.strong }),
    pill,
    name,
  )
  return [stem, period, ...drawCards({ ctx, row, sectioned })].join('')
}

function drawNotes({
  model,
  ctx,
  top,
  width,
}: {
  model: SequentialTimeline
  ctx: Context
  top: number
  width: number
}) {
  const lines = model.notes.flatMap((note) =>
    ctx.text.wrap(note, { size: SIZES.note, max: width - MARGIN * 2 }),
  )
  const lh = ctx.text.lineHeight({ size: SIZES.note })
  const body = lines.length
    ? text({
        x: MARGIN,
        y: top + SIZES.note,
        lines,
        size: SIZES.note,
        fill: ctx.tokens.muted,
        anchor: 'start',
        lineHeight: lh,
        shift: 0,
        valign: 'top',
      })
    : ''
  return { body, height: lines.length * lh }
}

/** Draws Mermaid's timeline syntax top to bottom: a spine of periods with their events beside. */
export function renderSequentialVertical(model: SequentialTimeline, ctx: Context): Drawing {
  const sectioned = model.sections.length > 0
  const layout = plan({ model, ctx })
  const titleWidth = ctx.text.width(model.title, { size: SIZES.title, weight: WEIGHT.title })
  const width = Math.max(layout.right + (sectioned ? 16 : 0), MARGIN + titleWidth) + MARGIN
  const notesTop = layout.bottom + (sectioned ? 0 : 8)
  const notes = drawNotes({ model, ctx, top: notesTop, width })
  const title = model.title
    ? text({
        x: MARGIN,
        y: MARGIN + 12,
        lines: [model.title],
        size: SIZES.title,
        weight: WEIGHT.title,
        fill: ctx.tokens.fg,
        anchor: 'start',
        lineHeight: 0,
        shift: ctx.text.baselineShift({ size: SIZES.title }),
      })
    : ''
  const body = [
    title,
    ...(sectioned ? drawBands({ ctx, layout }) : []),
    drawSpine({ ctx, layout }),
    ...(sectioned ? drawBandHeads({ ctx, layout }) : []),
    ...layout.rows.map((row) => drawRow({ ctx, layout, row, sectioned })),
    notes.body,
  ].join('')
  return { width, height: notesTop + notes.height + MARGIN, body, title: model.title }
}
