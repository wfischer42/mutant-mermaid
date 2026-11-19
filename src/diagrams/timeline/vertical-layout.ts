import type { TextKit } from '../../core/text.ts'
import { WEIGHT } from '../../theme/index.ts'
import { formatPoint, formatRange } from './dates.ts'
import { SIZES } from './layout.ts'
import type { Scale } from './scale.ts'
import type { Lane, TimelineEvent, TimelineSpan } from './syntax.ts'

/**
 * Where everything in a vertical dated timeline goes. Time runs down the page and lanes stand
 * side by side as columns. In each column, events hang off a spine with their labels to the right,
 * nudged apart vertically where they crowd; spans are bars packed into narrow sub-columns beside
 * the spine, each labelled at its top.
 */

/** From a lane's left edge to its spine. */
export const SPINE = 10
/** From the spine to the left edge of an event's label. */
export const LABEL_X = 18
export const V_BAR = 14
const LABEL_GAP = 5
const SPAN_GAP = 10
const NAME_MAX = 220
const SPAN_NAME_MAX = 170
const MIN_LANE = 150

export interface VEvent {
  event: TimelineEvent
  /** Where the event falls on the axis. */
  y: number
  /** The label's top, after nudging it clear of its neighbours. */
  top: number
  lines: string[]
  date: string
  width: number
  height: number
}

export interface VSpan {
  span: TimelineSpan
  y0: number
  y1: number
  column: number
  lines: string[]
  date: string
  width: number
  height: number
}

export interface VLane {
  lane: Lane
  x: number
  width: number
  events: VEvent[]
  spans: VSpan[]
  /** Left edge of each span sub-column, relative to the lane. */
  columns: number[]
  /** The lowest ink, which may run past the end of the axis. */
  bottom: number
}

export interface VPlot {
  scale: Scale
  kit: TextKit
}

export function eventStyle(event: TimelineEvent): { size: number; weight: number } {
  return event.major
    ? { size: SIZES.major, weight: WEIGHT.heading }
    : { size: SIZES.event, weight: WEIGHT.body }
}

export const SPAN_STYLE = { size: SIZES.span, weight: WEIGHT.body }
export const DATE_STYLE = { size: SIZES.date }

/** Label boxes, before they're nudged apart. */
function measureEvents({ events, plot }: { events: TimelineEvent[]; plot: VPlot }): VEvent[] {
  const { kit, scale } = plot
  return [...events]
    .sort((a, b) => a.at.t - b.at.t)
    .map((event) => {
      const style = eventStyle(event)
      const lines = kit.wrap(event.label, { ...style, max: NAME_MAX })
      const date = formatPoint({ point: event.at, now: scale.now, era: scale.era })
      const last = kit.width(lines[lines.length - 1] ?? '', style)
      const widest = Math.max(...lines.map((line) => kit.width(line, style)))
      const y = scale.x(event.at.t)
      return {
        event,
        y,
        top: y,
        lines,
        date,
        width: Math.max(widest, last + 8 + kit.width(date, DATE_STYLE)),
        height: lines.length * kit.lineHeight(style),
      }
    })
}

interface Block {
  first: number
  last: number
  top: number
  height: number
  /** Sum and count of the block tops each member would choose on its own. */
  sum: number
  count: number
}

function mergeLast({ blocks, gap, min }: { blocks: Block[]; gap: number; min: number }): void {
  while (blocks.length > 1) {
    const cur = blocks[blocks.length - 1]
    const prev = blocks[blocks.length - 2]
    if (prev.top + prev.height + gap <= cur.top) return
    const shift = prev.height + gap
    const sum = prev.sum + cur.sum - cur.count * shift
    const count = prev.count + cur.count
    blocks.splice(-2, 2, {
      first: prev.first,
      last: cur.last,
      height: shift + cur.height,
      sum,
      count,
      top: Math.max(min, sum / count),
    })
  }
}

/**
 * Tops for boxes that each want to be centred on a point, kept `gap` apart. Crowded boxes merge
 * into blocks that sit as close as they can to where their members want to be, on average.
 */
export function dodge({
  wants,
  heights,
  gap,
  min,
}: {
  wants: number[]
  heights: number[]
  gap: number
  min: number
}): number[] {
  const blocks: Block[] = []
  wants.forEach((want, i) => {
    const top = Math.max(min, want - heights[i] / 2)
    blocks.push({
      first: i,
      last: i,
      top,
      height: heights[i],
      sum: want - heights[i] / 2,
      count: 1,
    })
    mergeLast({ blocks, gap, min })
  })
  const tops: number[] = []
  for (const block of blocks) {
    let y = block.top
    for (let i = block.first; i <= block.last; i++) {
      tops.push(y)
      y += heights[i] + gap
    }
  }
  return tops
}

function placeEvents({ events, plot }: { events: TimelineEvent[]; plot: VPlot }): VEvent[] {
  const placed = measureEvents({ events, plot })
  const tops = dodge({
    wants: placed.map((p) => p.y),
    heights: placed.map((p) => p.height),
    gap: LABEL_GAP,
    min: plot.scale.x0 - 12,
  })
  placed.forEach((p, i) => {
    p.top = tops[i]
  })
  return placed
}

function measureSpan({ span, plot }: { span: TimelineSpan; plot: VPlot }): VSpan {
  const { kit, scale } = plot
  const lines = kit.wrap(span.label, { ...SPAN_STYLE, max: SPAN_NAME_MAX })
  const date = formatRange({ from: span.from, to: span.to, now: scale.now, era: scale.era })
  const y0 = scale.x(span.from.t)
  return {
    span,
    y0,
    y1: Math.max(scale.x(span.to.end), y0 + 8),
    column: 0,
    lines,
    date,
    width: Math.max(kit.width(date, DATE_STYLE), ...lines.map((l) => kit.width(l, SPAN_STYLE))),
    height: lines.length * kit.lineHeight(SPAN_STYLE) + kit.lineHeight(DATE_STYLE),
  }
}

/** Packs spans into sub-columns: each takes the first whose last occupant ends above it. */
function placeSpans({ spans, plot }: { spans: TimelineSpan[]; plot: VPlot }) {
  const ends: number[] = []
  const widths: number[] = []
  const placed = [...spans]
    .sort((a, b) => a.from.t - b.from.t)
    .map((span) => {
      const p = measureSpan({ span, plot })
      let column = 0
      while (ends[column] !== undefined && ends[column] + SPAN_GAP > p.y0) column++
      ends[column] = Math.max(p.y1, p.y0 + p.height)
      widths[column] = Math.max(widths[column] ?? 0, V_BAR + 8 + p.width + 18)
      p.column = column
      return p
    })
  return { placed, widths }
}

/** How wide the event area is: the spine and the widest label. */
function eventsWidth(events: VEvent[]): number {
  if (!events.length) return 0
  return SPINE + LABEL_X + Math.max(...events.map((e) => e.width)) + 20
}

export function layoutVLane({
  lane,
  plot,
  x,
  header,
}: {
  lane: Lane
  plot: VPlot
  x: number
  header: number
}): VLane {
  const events = placeEvents({ events: lane.items.filter((i) => i.kind === 'event'), plot })
  const spans = placeSpans({ spans: lane.items.filter((i) => i.kind === 'span'), plot })
  const columns: number[] = []
  let at = eventsWidth(events) || 4
  for (const width of spans.widths) {
    columns.push(at)
    at += width
  }
  const bottom = Math.max(
    plot.scale.x1,
    ...events.map((e) => e.top + e.height),
    ...spans.placed.map((s) => Math.max(s.y1, s.y0 + s.height)),
  )
  return {
    lane,
    x,
    width: Math.max(at, header, MIN_LANE),
    events,
    spans: spans.placed,
    columns,
    bottom,
  }
}

/**
 * How long the axis is. The busiest lane's labels, stacked end to end, set the scale: about one
 * and a half times that for `fit`, four times for `wide`, so labels mostly sit by their dates.
 */
export function axisLength({
  lanes,
  kit,
  length,
}: {
  lanes: Lane[]
  kit: TextKit
  length: 'fit' | 'wide' | number
}): number {
  if (typeof length === 'number') return length
  const stacked = Math.max(
    0,
    ...lanes.map((lane) =>
      lane.items.reduce(
        (sum, item) =>
          sum +
          (item.kind === 'event' ? kit.lineHeight(eventStyle(item)) : kit.lineHeight(SPAN_STYLE)) +
          LABEL_GAP,
        0,
      ),
    ),
  )
  if (length === 'wide') return Math.min(Math.max(stacked * 4, 900), 24000)
  return Math.min(Math.max(stacked * 1.5, 520), 2400)
}
