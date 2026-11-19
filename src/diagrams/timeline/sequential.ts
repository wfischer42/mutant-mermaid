import { roundedRect, softRect } from '../../core/geometry.ts'
import { target } from '../../core/hooks.ts'
import { h, n, text } from '../../core/svg.ts'
import { balance } from '../../core/text.ts'
import type { Context, Drawing } from '../../core/types.ts'
import { corner, OUTLINE, pick, type Swatch, swatchFor, WEIGHT } from '../../theme/index.ts'
import { periodIds, type SequentialTimeline } from './syntax.ts'

/**
 * Mermaid's timeline, drawn better: periods sit in order on a crisp axis as solid pills, their
 * events hang below as cards on a stem, and sections become tinted columns with a header chip.
 */

export const MARGIN = 28
const COL_GAP = 16
const SECTION_GAP = 18
export const CARD_GAP = 10
export const CARD_PAD = 11
export const SIZES = { title: 20, period: 14.5, event: 13.5, section: 13.5, note: 12.5 }

interface Column {
  x: number
  width: number
  pill: string[]
  cards: string[][]
  group: number
  swatch: Swatch
  /** The period's id and its events' ids, for the host app. */
  ids: { id: string; events: string[] }
}

export interface Group {
  label: string
  first: number
  last: number
  swatch: Swatch
}

/** Sections, or one group per period when there are none (Mermaid colors each period then). */
export function groupsOf({ model, ctx }: { model: SequentialTimeline; ctx: Context }): Group[] {
  const { tokens } = ctx
  const swatch = ({ index, color }: { index: number; color?: string }) =>
    (color && swatchFor({ tokens, color })) || pick({ tokens, index })
  if (!model.sections.length)
    return model.periods.map((_, i) => ({
      label: '',
      first: i,
      last: i,
      swatch: swatch({ index: i }),
    }))
  const groups: Group[] = []
  model.periods.forEach((period, i) => {
    const prev = groups[groups.length - 1]
    const key = period.section
    if (prev && model.periods[prev.first].section === key) {
      prev.last = i
      return
    }
    const section = model.sections[key]
    groups.push({
      label: section?.label ?? '',
      first: i,
      last: i,
      swatch: swatch({ index: groups.length, color: section?.color }),
    })
  })
  return groups
}

function columnWidth({ model, ctx }: { model: SequentialTimeline; ctx: Context }): number {
  const widths = model.periods.flatMap((p) => [
    ctx.text.width(p.label, { size: SIZES.period, weight: WEIGHT.heading }) + 32,
    ...p.events.map(
      (e) =>
        Math.min(ctx.text.width(e, { size: SIZES.event, weight: WEIGHT.body }), 170) + CARD_PAD * 2,
    ),
  ])
  return Math.min(Math.max(140, ...widths), 210)
}

function buildColumns({
  model,
  ctx,
  groups,
}: {
  model: SequentialTimeline
  ctx: Context
  groups: Group[]
}) {
  const width = columnWidth({ model, ctx })
  const columns: Column[] = []
  let x = MARGIN + (model.sections.length ? 10 : 0)
  const ids = periodIds(model)
  groups.forEach((group, g) => {
    if (g > 0) x += model.sections.length ? SECTION_GAP + 20 : 0
    for (let i = group.first; i <= group.last; i++) {
      const period = model.periods[i]
      columns.push({
        x,
        width,
        pill: balance({
          kit: ctx.text,
          text: period.label,
          style: { size: SIZES.period, weight: WEIGHT.heading },
          max: width - 28,
        }),
        cards: period.events.map((e) =>
          ctx.text.wrap(e, { size: SIZES.event, weight: WEIGHT.body, max: width - CARD_PAD * 2 }),
        ),
        group: g,
        swatch: group.swatch,
        ids: ids.get(period) ?? { id: '', events: [] },
      })
      x += width + COL_GAP
    }
  })
  return columns
}

interface Rows {
  sectionTop: number
  pillMid: number
  pillHeight: number
  cardsTop: number
  bottom: number
  lineHeight: number
}

export function cardHeight({ lines, lineHeight }: { lines: string[]; lineHeight: number }): number {
  return lines.length * lineHeight + CARD_PAD * 2 - 4
}

function measureRows({
  model,
  ctx,
  columns,
}: {
  model: SequentialTimeline
  ctx: Context
  columns: Column[]
}): Rows {
  const lineHeight = ctx.text.lineHeight({ size: SIZES.event })
  const titleBlock = model.title ? 52 : 0
  const sectionTop = MARGIN + titleBlock
  const pillLines = Math.max(1, ...columns.map((c) => c.pill.length))
  const pillHeight = pillLines * ctx.text.lineHeight({ size: SIZES.period }) + 16
  const pillMid = sectionTop + (model.sections.length ? 46 : 0) + pillHeight / 2
  const cardsTop = pillMid + pillHeight / 2 + 22
  const stacks = columns.map((c) =>
    c.cards.reduce((sum, lines) => sum + cardHeight({ lines, lineHeight }) + CARD_GAP, 0),
  )
  const bottom = cardsTop + Math.max(0, ...stacks)
  return { sectionTop, pillMid, pillHeight, cardsTop, bottom, lineHeight }
}

function drawSections({
  ctx,
  groups,
  columns,
  rows,
}: {
  ctx: Context
  groups: Group[]
  columns: Column[]
  rows: Rows
}): string[] {
  return groups.map((group, g) => {
    const cols = columns.filter((c) => c.group === g)
    const x = cols[0].x - 10
    const w = cols[cols.length - 1].x + cols[cols.length - 1].width - cols[0].x + 20
    const name =
      ctx.text.wrap(group.label, { size: SIZES.section, weight: WEIGHT.heading, max: w - 24 })[0] ??
      ''
    return [
      h('path', {
        d: roundedRect({
          x,
          y: rows.sectionTop,
          w,
          h: rows.bottom - rows.sectionTop + 8,
          r: corner({ tokens: ctx.tokens, r: 14 }),
        }),
        fill: group.swatch.fill,
        opacity: ctx.tokens.dark ? 0.7 : 1,
      }),
      h('path', {
        d: roundedRect({
          x: x + 6,
          y: rows.sectionTop + 6,
          w: w - 12,
          h: 28,
          r: corner({ tokens: ctx.tokens, r: 9 }),
        }),
        fill: group.swatch.soft,
      }),
      text({
        x: x + w / 2,
        y: rows.sectionTop + 20,
        lines: [name],
        size: SIZES.section,
        weight: WEIGHT.heading,
        fill: group.swatch.ink,
        lineHeight: 0,
        shift: ctx.text.baselineShift({ size: SIZES.section }),
      }),
    ].join('')
  })
}

function drawAxis({ ctx, columns, rows }: { ctx: Context; columns: Column[]; rows: Rows }): string {
  const first = columns[0]
  const last = columns[columns.length - 1]
  const x0 = first.x - 6
  const x1 = last.x + last.width + 14
  const y = rows.pillMid
  return [
    h('path', {
      d: `M${n(x0)} ${n(y)}H${n(x1)}`,
      stroke: ctx.tokens.faint,
      'stroke-width': 2.5,
      'stroke-linecap': 'round',
    }),
    h('path', {
      d: `M${n(x1 - 7)} ${n(y - 6)}L${n(x1 + 1)} ${n(y)}L${n(x1 - 7)} ${n(y + 6)}`,
      stroke: ctx.tokens.faint,
      'stroke-width': 2.5,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      fill: 'none',
    }),
  ].join('')
}

export function cardShape({
  ctx,
  x,
  y,
  w,
  hh,
}: {
  ctx: Context
  x: number
  y: number
  w: number
  hh: number
}) {
  if (ctx.tokens.look === 'sketch')
    return softRect({ x, y, w, h: hh, r: 9, rng: ctx.rng, wobble: 0.9 })
  const r = corner({ tokens: ctx.tokens, r: ctx.tokens.look === 'organic' ? 12 : 8 })
  return roundedRect({ x, y, w, h: hh, r })
}

function drawColumn({
  ctx,
  column,
  rows,
  sectioned,
}: {
  ctx: Context
  column: Column
  rows: Rows
  sectioned: boolean
}): string {
  const { tokens } = ctx
  const sw = column.swatch
  const cx = column.x + column.width / 2
  const pillW = Math.min(
    column.width,
    Math.max(
      ...column.pill.map((l) => ctx.text.width(l, { size: SIZES.period, weight: WEIGHT.heading })),
    ) + 30,
  )
  const parts: string[] = []
  let y = rows.cardsTop
  const tops = column.cards.map((lines) => {
    const top = y
    y += cardHeight({ lines, lineHeight: rows.lineHeight }) + CARD_GAP
    return top
  })
  if (column.cards.length)
    parts.push(
      h('path', {
        d: `M${n(cx)} ${n(rows.pillMid)}V${n(tops[tops.length - 1] + 6)}`,
        stroke: sw.stroke,
        'stroke-width': 1.5,
      }),
    )
  parts.push(
    h(
      'g',
      target({ id: column.ids.id, kind: 'period', tint: sw.strong }),
      h('path', {
        d: roundedRect({
          x: cx - pillW / 2,
          y: rows.pillMid - rows.pillHeight / 2,
          w: pillW,
          h: rows.pillHeight,
          r: corner({ tokens, r: rows.pillHeight / 2 }),
        }),
        fill: sw.strong,
        stroke: tokens.bg,
        'stroke-width': 3,
      }),
      text({
        x: cx,
        y: rows.pillMid,
        lines: column.pill,
        size: SIZES.period,
        weight: WEIGHT.heading,
        fill: tokens.bg,
        lineHeight: ctx.text.lineHeight({ size: SIZES.period }),
        shift: ctx.text.baselineShift({ size: SIZES.period }),
      }),
    ),
  )
  column.cards.forEach((lines, i) => {
    const hh = cardHeight({ lines, lineHeight: rows.lineHeight })
    parts.push(
      h(
        'g',
        target({ id: column.ids.events[i] ?? '', kind: 'event', tint: sw.stroke }),
        h('path', {
          d: cardShape({ ctx, x: column.x, y: tops[i], w: column.width, hh }),
          fill: sectioned ? tokens.surface : sw.fill,
          stroke: sw.soft,
          'stroke-width': OUTLINE.thin,
          filter: 'url(#mm-shadow)',
        }),
        text({
          x: cx,
          y: tops[i] + hh / 2,
          lines,
          size: SIZES.event,
          weight: WEIGHT.body,
          fill: sw.ink,
          lineHeight: rows.lineHeight,
          shift: ctx.text.baselineShift({ size: SIZES.event }),
        }),
      ),
    )
  })
  return parts.join('')
}

/** Draws Mermaid's timeline syntax: ordered periods, events beneath, sections as tinted columns. */
export function renderSequential(model: SequentialTimeline, ctx: Context): Drawing {
  const groups = groupsOf({ model, ctx })
  const columns = buildColumns({ model, ctx, groups })
  const rows = measureRows({ model, ctx, columns })
  const sectioned = model.sections.length > 0
  const last = columns[columns.length - 1]
  const width = last.x + last.width + (sectioned ? 10 : 0) + MARGIN
  const noteLines = model.notes.flatMap((note) =>
    ctx.text.wrap(note, { size: SIZES.note, max: width - MARGIN * 2 }),
  )
  const noteLh = ctx.text.lineHeight({ size: SIZES.note })
  const notesTop = rows.bottom + (sectioned ? 18 : 6)
  const body = [
    model.title &&
      text({
        x: MARGIN,
        y: MARGIN + 12,
        lines: [model.title],
        size: SIZES.title,
        weight: WEIGHT.title,
        fill: ctx.tokens.fg,
        anchor: 'start',
        lineHeight: 0,
        shift: ctx.text.baselineShift({ size: SIZES.title }),
      }),
    ...(sectioned ? drawSections({ ctx, groups, columns, rows }) : []),
    drawAxis({ ctx, columns, rows }),
    ...columns.map((column) => drawColumn({ ctx, column, rows, sectioned })),
    noteLines.length &&
      text({
        x: MARGIN,
        y: notesTop + SIZES.note,
        lines: noteLines,
        size: SIZES.note,
        fill: ctx.tokens.muted,
        anchor: 'start',
        lineHeight: noteLh,
        shift: 0,
        valign: 'top',
      }),
  ]
    .filter((part) => typeof part === 'string')
    .join('')
  return {
    width,
    height: notesTop + noteLines.length * noteLh + MARGIN - 6,
    body,
    title: model.title,
  }
}
