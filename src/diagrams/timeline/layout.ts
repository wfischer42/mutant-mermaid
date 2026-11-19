import type { TextKit } from '../../core/text.ts'
import { WEIGHT } from '../../theme/index.ts'
import { formatPoint, formatRange } from './dates.ts'
import type { Scale } from './scale.ts'
import type { Era, Lane, TimelineEvent, TimelineSpan } from './syntax.ts'

/**
 * Where everything in a dated timeline goes, before any drawing. Events stack their labels into
 * rows above a baseline so no two collide and no label covers another's stem; spans pack into
 * rows below it with their labels inside the bar when they fit, beside it when they don't.
 */

export const SIZES = {
  title: 20,
  lane: 14,
  event: 13.5,
  major: 14.5,
  date: 11.5,
  span: 13,
  tick: 12,
  era: 12.5,
  note: 12.5,
}

/** Height of one row of event labels: a name line and a date line. */
export const ROW = 35
/** Room for the markers on an event baseline. */
export const MARK = 16
export const BAR = 24
export const BAR_GAP = 7
export const LANE_PAD = 14
export const ERA_ROW = 26
const LABEL_GAP = 14
const STEM = 7
/** How far past the plot's right edge a label may run before it flips to the left of its stem. */
const OVERHANG = 70

export interface Interval {
  l: number
  r: number
}

export interface PlacedEvent {
  event: TimelineEvent
  x: number
  /** Label row counted down from the top of the lane; the deepest row sits on the baseline. */
  row: number
  anchor: 'start' | 'end'
  name: string
  date: string
  box: Interval
}

export interface PlacedSpan {
  span: TimelineSpan
  x0: number
  x1: number
  row: number
  label: string
  date: string
  /** Where the label sits, and whether the date fits beside it. */
  place: 'inside' | 'right' | 'left'
  showDate: boolean
  extent: Interval
}

export interface LaneLayout {
  lane: Lane
  events: PlacedEvent[]
  spans: PlacedSpan[]
  eventRows: number
  spanRows: number
  height: number
  /** The rightmost and leftmost ink, for sizing the canvas. */
  extent: Interval
}

export interface PlacedEra {
  era: Era
  x0: number
  x1: number
  depth: number
}

function overlaps({ a, b, gap }: { a: Interval; b: Interval; gap: number }): boolean {
  return a.l < b.r + gap && b.l < a.r + gap
}

function isFree({
  row,
  interval,
  gap,
}: {
  row: Interval[] | undefined
  interval: Interval
  gap: number
}): boolean {
  return !row?.some((b) => overlaps({ a: interval, b, gap }))
}

function push({
  rows,
  index,
  interval,
}: {
  rows: Interval[][]
  index: number
  interval: Interval
}) {
  while (rows.length <= index) rows.push([])
  rows[index].push(interval)
}

interface Plot {
  scale: Scale
  kit: TextKit
  left: number
  right: number
}

function eventStyle(event: TimelineEvent): { size: number; weight: number } {
  return event.major
    ? { size: SIZES.major, weight: WEIGHT.heading }
    : { size: SIZES.event, weight: WEIGHT.body }
}

/** The box an event's label needs, flipped left of the stem when it would overhang the plot. */
function eventBox({ event, x, plot }: { event: TimelineEvent; x: number; plot: Plot }) {
  const name = event.label
  const date = formatPoint({ point: event.at, now: plot.scale.now, era: plot.scale.era })
  const width =
    Math.max(plot.kit.width(name, eventStyle(event)), plot.kit.width(date, { size: SIZES.date })) +
    STEM
  const flip = x + width > plot.right + OVERHANG && x - width >= plot.left - 24
  const anchor: 'start' | 'end' = flip ? 'end' : 'start'
  const box = flip ? { l: x - width, r: x + 3 } : { l: x - 3, r: x + width }
  return { name, date, anchor, box }
}

/** The part of a label box that holds text, which another event's stem must not cross. */
function textRegion(p: PlacedEvent): Interval {
  return p.anchor === 'start' ? { l: p.x + 5, r: p.box.r } : { l: p.box.l, r: p.x - 5 }
}

function crosses({ stem, p }: { stem: number; p: PlacedEvent }): boolean {
  const region = textRegion(p)
  return stem > region.l - 2 && stem < region.r + 2
}

/**
 * Whether two placed labels get along. Rows count down from the top, and a stem runs from the
 * baseline up to its own row, so it passes through every row below its label.
 */
function compatible({ a, b }: { a: PlacedEvent; b: PlacedEvent }): boolean {
  if (a.row === b.row) return !overlaps({ a: a.box, b: b.box, gap: LABEL_GAP })
  const [upper, lower] = a.row < b.row ? [a, b] : [b, a]
  return !crosses({ stem: upper.x, p: lower })
}

function fitsAmong({ p, others }: { p: PlacedEvent; others: PlacedEvent[] }): boolean {
  return others.every((o) => o === p || compatible({ a: p, b: o }))
}

/** Moves each label as close to the baseline as it can go, shortening its stem. */
function compact({ placed, rows }: { placed: PlacedEvent[]; rows: number }): void {
  for (const p of [...placed].sort((a, b) => b.row - a.row)) {
    const original = p.row
    for (let row = rows - 1; row > original; row--) {
      p.row = row
      if (fitsAmong({ p, others: placed })) break
      p.row = original
    }
  }
}

/**
 * Stacks event labels into rows. Left to right, each label takes the highest row where it
 * neither overlaps a label nor sits across another's stem; then all of them drop as close to the
 * baseline as they can.
 */
function placeEvents({ events, plot }: { events: TimelineEvent[]; plot: Plot }) {
  const placed: PlacedEvent[] = []
  const sorted = [...events].sort((a, b) => a.at.t - b.at.t)
  for (const event of sorted) {
    const x = plot.scale.x(event.at.t)
    const p: PlacedEvent = { event, x, row: 0, ...eventBox({ event, x, plot }) }
    while (p.row <= placed.length && !fitsAmong({ p, others: placed })) p.row++
    placed.push(p)
  }
  const rows = placed.length ? Math.max(...placed.map((p) => p.row)) + 1 : 0
  compact({ placed, rows })
  return { placed, rows }
}

function spanExtent({
  x0,
  x1,
  plot,
  widths,
}: {
  x0: number
  x1: number
  plot: Plot
  widths: { label: number; date: number }
}): Pick<PlacedSpan, 'place' | 'showDate' | 'extent'> {
  const inner = x1 - x0
  if (widths.label + 22 <= inner)
    return {
      place: 'inside',
      showDate: widths.label + widths.date + 40 <= inner,
      extent: { l: x0, r: x1 },
    }
  const outside = widths.label + 8 + widths.date
  if (x1 + 10 + outside <= plot.right + OVERHANG)
    return { place: 'right', showDate: true, extent: { l: x0, r: x1 + 10 + outside } }
  return { place: 'left', showDate: true, extent: { l: x0 - 10 - outside, r: x1 } }
}

const MIN_BAR = 8

function placeSpans({ spans, plot }: { spans: TimelineSpan[]; plot: Plot }) {
  const rows: Interval[][] = []
  const placed: PlacedSpan[] = []
  const sorted = [...spans].sort((a, b) => a.from.t - b.from.t)
  for (const span of sorted) {
    const x0 = plot.scale.x(span.from.t)
    const x1 = Math.max(plot.scale.x(span.to.end), x0 + MIN_BAR)
    const date = formatRange({
      from: span.from,
      to: span.to,
      now: plot.scale.now,
      era: plot.scale.era,
    })
    const widths = {
      label: plot.kit.width(span.label, { size: SIZES.span, weight: WEIGHT.body }),
      date: plot.kit.width(date, { size: SIZES.date }),
    }
    const where = spanExtent({ x0, x1, plot, widths })
    let row = 0
    while (!isFree({ row: rows[row], interval: where.extent, gap: 10 })) row++
    push({ rows, index: row, interval: where.extent })
    placed.push({ span, x0, x1, row, label: span.label, date, ...where })
  }
  return { placed, rows: rows.length }
}

export function layoutLane({ lane, plot }: { lane: Lane; plot: Plot }): LaneLayout {
  const events = lane.items.filter((item) => item.kind === 'event')
  const spans = lane.items.filter((item) => item.kind === 'span')
  const e = placeEvents({ events, plot })
  const s = placeSpans({ spans, plot })
  const eventZone = e.rows ? e.rows * ROW + MARK : 0
  const spanZone = s.rows ? s.rows * (BAR + BAR_GAP) - BAR_GAP : 0
  const between = e.rows && s.rows ? 10 : 0
  const height = Math.max(52, LANE_PAD * 2 + eventZone + spanZone + between)
  const extents = [...e.placed.map((p) => p.box), ...s.placed.map((p) => p.extent)]
  const extent = {
    l: Math.min(plot.left, ...extents.map((x) => x.l)),
    r: Math.max(plot.right, ...extents.map((x) => x.r)),
  }
  return {
    lane,
    events: e.placed,
    spans: s.placed,
    eventRows: e.rows,
    spanRows: s.rows,
    height,
    extent,
  }
}

/** Eras with their depth: how many other eras contain each one. */
export function layoutEras({ eras, scale }: { eras: Era[]; scale: Scale }): PlacedEra[] {
  return eras.map((era, i) => {
    const depth = eras.filter(
      (other, j) =>
        j !== i && contains({ outer: other, inner: era }) && !same({ a: other, b: era }),
    ).length
    const x0 = Math.max(scale.x0, scale.x(era.from.t))
    const end = era.to.unit === 'now' && scale.kind === 'log' ? scale.x1 : scale.x(era.to.end)
    const x1 = Math.min(scale.x1, Math.max(end, x0 + 2))
    return { era, x0, x1, depth }
  })
}

function contains({ outer, inner }: { outer: Era; inner: Era }): boolean {
  return outer.from.t <= inner.from.t && outer.to.t >= inner.to.t
}

function same({ a, b }: { a: Era; b: Era }): boolean {
  return a.from.t === b.from.t && a.to.t === b.to.t
}
