import { roundedRect, softRect } from '../../core/geometry.ts'
import { target } from '../../core/hooks.ts'
import { h, n, text } from '../../core/svg.ts'
import type { Context, Drawing } from '../../core/types.ts'
import {
  corner,
  OUTLINE,
  pick,
  type Swatch,
  swatchFor,
  type Tokens,
  WEIGHT,
} from '../../theme/index.ts'
import {
  BAR,
  BAR_GAP,
  ERA_ROW,
  LANE_PAD,
  type LaneLayout,
  layoutEras,
  layoutLane,
  MARK,
  type PlacedEra,
  type PlacedEvent,
  type PlacedSpan,
  ROW,
  SIZES,
} from './layout.ts'
import { chooseScale, makeScale, makeTicks, type Scale, type Tick } from './scale.ts'
import { type DatedTimeline, itemIds, type Lane, type TimelineItem } from './syntax.ts'

const MARGIN = 28

interface Frame {
  ctx: Context
  model: DatedTimeline
  /** Each event and span's id for the host app. */
  ids: Map<TimelineItem, string>
  scale: Scale
  ticks: Tick[]
  eras: PlacedEra[]
  eraRows: number
  lanes: LaneLayout[]
  laneSwatches: Swatch[]
  laneLeft: number
  titleTop: number
  erasTop: number
  lanesTop: number
  lanesBottom: number
}

export function allTimes(model: DatedTimeline): number[] {
  const times: number[] = []
  for (const lane of model.lanes)
    for (const item of lane.items)
      if (item.kind === 'event') times.push(item.at.t)
      else times.push(item.from.t, item.to.end)
  for (const era of model.eras) times.push(era.from.t, era.to.end)
  return times
}

export function laneSwatch({ lane, index, tokens }: { lane: Lane; index: number; tokens: Tokens }) {
  return (lane.color && swatchFor({ tokens, color: lane.color })) || pick({ tokens, index })
}

/** Width for the lane-label column: the widest label, wrapped at a sensible measure. */
function laneColumn({ model, ctx }: { model: DatedTimeline; ctx: Context }): number {
  const labelled = model.lanes.filter((lane) => lane.label)
  if (!labelled.length) return 0
  const widest = Math.max(
    ...labelled.map((lane) =>
      ctx.text.width(lane.label, { size: SIZES.lane, weight: WEIGHT.heading }),
    ),
  )
  return Math.min(Math.max(widest, 70), 150) + 34
}

/**
 * Plot width grows with how much label text the busiest lane carries: within a page for
 * `length=fit`, and until most labels sit side by side for `length=wide`.
 */
function plotWidth({ model, ctx }: { model: DatedTimeline; ctx: Context }): number {
  if (typeof model.length === 'number') return model.length
  const density = Math.max(
    0,
    ...model.lanes.map((lane) =>
      lane.items.reduce(
        (sum, item) =>
          sum + ctx.text.width(item.label, { size: SIZES.event, weight: WEIGHT.body }) + 24,
        0,
      ),
    ),
  )
  if (model.length === 'wide') return Math.min(Math.max(density * 1.1, 1400), 24000)
  return Math.min(Math.max(density * 0.45, 880), 1180)
}

function buildFrame({ model, ctx }: { model: DatedTimeline; ctx: Context }): Frame {
  const { tokens, text: kit } = ctx
  const column = laneColumn({ model, ctx })
  const left = MARGIN + column
  const right = left + plotWidth({ model, ctx })
  const times = allTimes(model)
  const kind = chooseScale({ requested: model.scale, times, now: model.now })
  const scale = makeScale({ kind, times, now: model.now, x0: left, x1: right })
  const measure = (label: string) => kit.width(label, { size: SIZES.tick, weight: WEIGHT.heading })
  const ticks = makeTicks({ scale, measure })
  const eras = layoutEras({ eras: model.eras, scale })
  const eraRows = eras.length ? Math.max(...eras.map((e) => e.depth)) + 1 : 0
  const plot = { scale, kit, left, right }
  const lanes = model.lanes.map((lane) => layoutLane({ lane, plot }))
  const titleTop = MARGIN
  const erasTop = titleTop + (model.title ? 48 : 0)
  const lanesTop = erasTop + (eraRows ? eraRows * ERA_ROW + 4 : 8)
  const lanesBottom = lanesTop + lanes.reduce((sum, lane) => sum + lane.height, 0)
  const laneSwatches = model.lanes.map((lane, index) => laneSwatch({ lane, index, tokens }))
  return {
    ctx,
    model,
    ids: itemIds(model),
    scale,
    ticks,
    eras,
    eraRows,
    lanes,
    laneSwatches,
    laneLeft: MARGIN,
    titleTop,
    erasTop,
    lanesTop,
    lanesBottom,
  }
}

export function label({
  ctx,
  x,
  y,
  value,
  size,
  weight,
  fill,
  anchor = 'start',
}: {
  ctx: Context
  x: number
  y: number
  value: string
  size: number
  weight?: number
  fill: string
  anchor?: 'start' | 'middle' | 'end'
}): string {
  return text({
    x,
    y,
    lines: [value],
    size,
    weight,
    fill,
    anchor,
    lineHeight: ctx.text.lineHeight({ size }),
    shift: ctx.text.baselineShift({ size }),
  })
}

function eraSwatch({ frame, index }: { frame: Frame; index: number }): Swatch {
  return eraColor({ model: frame.model, index, tokens: frame.ctx.tokens })
}

/** An era's color: its own, or the next palette entry after the lanes'. */
export function eraColor({
  model,
  index,
  tokens,
}: {
  model: DatedTimeline
  index: number
  tokens: Tokens
}): Swatch {
  const era = model.eras[index]
  return (
    (era.color && swatchFor({ tokens, color: era.color })) ||
    pick({ tokens, index: model.lanes.length + index + 2 })
  )
}

/** Truncates a label with an ellipsis to fit `max`, or returns '' when even "Ab…" won't. */
export function fit({
  ctx,
  value,
  max,
  size,
}: {
  ctx: Context
  value: string
  max: number
  size: number
}) {
  const style = { size, weight: WEIGHT.heading }
  if (ctx.text.width(value, style) <= max) return value
  for (let k = value.length - 1; k >= 2; k--) {
    const cut = `${value.slice(0, k).trimEnd()}…`
    if (ctx.text.width(cut, style) <= max) return cut
  }
  const initial = value.slice(0, 1)
  return ctx.text.width(initial, style) <= max ? initial : ''
}

function drawEras(frame: Frame): string[] {
  const { ctx } = frame
  const dark = ctx.tokens.dark
  const order = frame.eras
    .map((_, i) => i)
    .sort((a, b) => frame.eras[a].depth - frame.eras[b].depth)
  return order.map((i) => {
    const placed = frame.eras[i]
    const sw = eraSwatch({ frame, index: i })
    const chipTop = frame.erasTop + placed.depth * ERA_ROW
    const width = placed.x1 - placed.x0
    const name = fit({ ctx, value: placed.era.label, max: width - 12, size: SIZES.era })
    return [
      h('rect', {
        x: placed.x0,
        y: chipTop + ERA_ROW - 4,
        width,
        height: frame.lanesBottom - chipTop - ERA_ROW + 4,
        fill: sw.fill,
        opacity: dark ? 0.42 : 0.62,
      }),
      h('path', {
        d: `M${n(placed.x0)} ${n(chipTop)}V${n(frame.lanesBottom)}`,
        stroke: sw.stroke,
        'stroke-width': 1,
        opacity: 0.35,
      }),
      h('path', {
        d: roundedRect({
          x: placed.x0,
          y: chipTop,
          w: width,
          h: ERA_ROW - 4,
          r: corner({ tokens: ctx.tokens, r: 5 }),
        }),
        fill: sw.soft,
      }),
      name &&
        label({
          ctx,
          x: placed.x0 + width / 2,
          y: chipTop + (ERA_ROW - 4) / 2,
          value: name,
          size: SIZES.era,
          weight: WEIGHT.heading,
          fill: sw.ink,
          anchor: 'middle',
        }),
    ].join('')
  })
}

function drawGrid(frame: Frame): string[] {
  const { tokens } = frame.ctx
  return frame.ticks.map((tick) =>
    h('path', {
      d: `M${n(tick.x)} ${n(frame.lanesTop)}V${n(frame.lanesBottom)}`,
      stroke: tokens.border,
      'stroke-width': 1,
      'stroke-dasharray': tick.major ? undefined : '2 4',
      opacity: tick.major ? 0.9 : 1,
    }),
  )
}

function laneTops(frame: Frame): number[] {
  let y = frame.lanesTop
  return frame.lanes.map((lane) => {
    const top = y
    y += lane.height
    return top
  })
}

function drawLaneRule({
  frame,
  index,
  top,
  to = frame.scale.x1,
}: {
  frame: Frame
  index: number
  top: number
  to?: number
}) {
  if (index === 0) return ''
  return h('path', {
    d: `M${n(frame.laneLeft)} ${n(top)}H${n(to)}`,
    stroke: frame.ctx.tokens.border,
    'stroke-width': 1,
  })
}

/** A lane's name and color bar, in the column left of the plot. */
function drawLaneName({ frame, index, top }: { frame: Frame; index: number; top: number }) {
  const { ctx } = frame
  const layout = frame.lanes[index]
  const sw = frame.laneSwatches[index]
  if (!layout.lane.label) return ''
  const lines = ctx.text.wrap(layout.lane.label, {
    size: SIZES.lane,
    weight: WEIGHT.heading,
    max: frame.scale.x0 - frame.laneLeft - 30,
  })
  return (
    h('path', {
      d: roundedRect({
        x: frame.scale.x0 - 14,
        y: top + 8,
        w: 4,
        h: layout.height - 16,
        r: corner({ tokens: ctx.tokens, r: 2 }),
      }),
      fill: sw.stroke,
    }) +
    text({
      x: frame.laneLeft,
      y: top + layout.height / 2,
      lines,
      size: SIZES.lane,
      weight: WEIGHT.heading,
      fill: sw.strong,
      anchor: 'start',
      lineHeight: ctx.text.lineHeight({ size: SIZES.lane }),
      shift: ctx.text.baselineShift({ size: SIZES.lane }),
    })
  )
}

/**
 * The title and lane names, marked to stay at the left edge while a long timeline scrolls. The
 * backing hides the plot passing underneath; without a viewer that moves it, it sits in place.
 */
function drawPinned({ frame, tops, title }: { frame: Frame; tops: number[]; title: string }) {
  const names = frame.lanes.map((_, index) => drawLaneName({ frame, index, top: tops[index] }))
  if (!names.some(Boolean)) return title
  const width = frame.scale.x0 - 6
  const backing = h('rect', {
    x: 0,
    y: frame.erasTop - 4,
    width,
    height: frame.lanesBottom - frame.erasTop + 4,
    fill: frame.ctx.tokens.bg,
  })
  const rules = tops.map((top, index) => drawLaneRule({ frame, index, top, to: width }))
  return h('g', { 'data-sticky': 'left' }, backing, ...rules, ...names, title)
}

export function itemSwatch({
  color,
  fallback,
  tokens,
}: {
  color?: string
  fallback: Swatch
  tokens: Tokens
}) {
  return (color && swatchFor({ tokens, color })) || fallback
}

function fadeMask({ id, span }: { id: string; span: PlacedSpan }): string {
  const fade = Math.min(30, (span.x1 - span.x0) / 3)
  const w = span.x1 - span.x0
  const softStart = span.span.from.approximate || span.span.from.uncertain
  const softEnd = span.span.to.approximate || span.span.to.uncertain
  const stops = [
    h('stop', { offset: 0, 'stop-color': '#fff', 'stop-opacity': softStart ? 0.05 : 1 }),
    h('stop', { offset: softStart ? fade / w : 0, 'stop-color': '#fff', 'stop-opacity': 1 }),
    h('stop', { offset: softEnd ? 1 - fade / w : 1, 'stop-color': '#fff', 'stop-opacity': 1 }),
    h('stop', { offset: 1, 'stop-color': '#fff', 'stop-opacity': softEnd ? 0.05 : 1 }),
  ]
  return (
    h('linearGradient', { id: `${id}-g`, x1: 0, x2: 1, y1: 0, y2: 0 }, ...stops) +
    h(
      'mask',
      { id, maskContentUnits: 'objectBoundingBox' },
      h('rect', { width: 1, height: 1, fill: `url(#${id}-g)` }),
    )
  )
}

function isFuzzy(span: PlacedSpan): boolean {
  const { from, to } = span.span
  return from.approximate || from.uncertain || to.approximate || to.uncertain
}

interface SpanDraw {
  frame: Frame
  span: PlacedSpan
  y: number
  sw: Swatch
  id: string
}

function spanShape({ frame, span, y }: Omit<SpanDraw, 'sw' | 'id'>): string {
  const { ctx } = frame
  const w = span.x1 - span.x0
  const r = ctx.tokens.look === 'organic' ? BAR / 2 : 6
  if (ctx.tokens.look === 'sketch')
    return softRect({ x: span.x0, y, w, h: BAR, r, rng: ctx.rng, wobble: 0.8 })
  return roundedRect({ x: span.x0, y, w, h: BAR, r: corner({ tokens: ctx.tokens, r }) })
}

function spanLabels({ frame, span, y, sw }: Omit<SpanDraw, 'id'>): string[] {
  const { ctx } = frame
  const mid = y + BAR / 2
  const strong = span.span.major
  const ink = strong ? ctx.tokens.bg : sw.ink
  const dateW = ctx.text.width(span.date, { size: SIZES.date })
  const labelW = ctx.text.width(span.label, { size: SIZES.span, weight: WEIGHT.body })
  if (span.place === 'inside')
    return [
      label({
        ctx,
        x: span.x0 + 10,
        y: mid,
        value: span.label,
        size: SIZES.span,
        weight: WEIGHT.body,
        fill: ink,
      }),
      span.showDate &&
        label({
          ctx,
          x: span.x1 - 10,
          y: mid,
          value: span.date,
          size: SIZES.date,
          fill: ink,
          anchor: 'end',
        }),
    ].filter((part): part is string => Boolean(part))
  const start = span.place === 'right' ? span.x1 + 10 : span.x0 - 10 - labelW - 8 - dateW
  return [
    label({
      ctx,
      x: start,
      y: mid,
      value: span.label,
      size: SIZES.span,
      weight: WEIGHT.body,
      fill: sw.strong,
    }),
    label({
      ctx,
      x: start + labelW + 8,
      y: mid,
      value: span.date,
      size: SIZES.date,
      fill: ctx.tokens.muted,
    }),
  ]
}

function drawSpan(args: SpanDraw): { body: string; defs: string } {
  const { span, y, sw, id } = args
  const fuzzy = isFuzzy(span)
  const strong = span.span.major
  const shape = h('path', {
    d: spanShape(args),
    fill: strong ? sw.stroke : sw.soft,
    stroke: sw.stroke,
    'stroke-width': OUTLINE.thin,
    mask: fuzzy ? `url(#${id})` : undefined,
  })
  const uncertainEnds = [span.span.from.uncertain && span.x0, span.span.to.uncertain && span.x1]
    .filter((x): x is number => typeof x === 'number')
    .map((x) =>
      h('path', {
        d: `M${n(x)} ${n(y - 3)}V${n(y + BAR + 3)}`,
        stroke: sw.stroke,
        'stroke-width': 1.2,
        'stroke-dasharray': '2 2',
      }),
    )
  return {
    body: [shape, ...uncertainEnds, ...spanLabels(args)].join(''),
    defs: fuzzy ? fadeMask({ id, span }) : '',
  }
}

export function marker({
  placed,
  y,
  sw,
  tokens,
}: {
  placed: Pick<PlacedEvent, 'event' | 'x'>
  y: number
  sw: Swatch
  tokens: Tokens
}) {
  const { event, x } = placed
  const soft = event.at.approximate
  const hollow = event.at.uncertain
  const r = event.major ? 7 : 5
  const parts: string[] = []
  if (event.major)
    parts.push(
      h('circle', {
        cx: x,
        cy: y,
        r: r + 5,
        fill: 'none',
        stroke: sw.stroke,
        'stroke-width': 1.2,
        opacity: 0.5,
      }),
    )
  if (soft) parts.push(h('circle', { cx: x, cy: y, r: r + 4, fill: sw.stroke, opacity: 0.18 }))
  const fill = hollow ? tokens.bg : sw.strong
  const stroke = hollow ? sw.stroke : tokens.bg
  const common = {
    fill,
    stroke,
    'stroke-width': hollow ? 1.6 : 2,
    'stroke-dasharray': hollow ? '2.2 1.6' : undefined,
    opacity: soft && !hollow ? 0.75 : undefined,
  }
  if (event.milestone) {
    const d = r + 2
    parts.push(
      h('path', {
        d: `M${n(x)} ${n(y - d)}L${n(x + d)} ${n(y)}L${n(x)} ${n(y + d)}L${n(x - d)} ${n(y)}Z`,
        ...common,
      }),
    )
  } else parts.push(h('circle', { cx: x, cy: y, r, ...common }))
  return parts.join('')
}

function drawEvent({
  frame,
  placed,
  top,
  rows,
  sw,
}: {
  frame: Frame
  placed: PlacedEvent
  top: number
  rows: number
  sw: Swatch
}): string {
  const { ctx } = frame
  const { tokens } = ctx
  const boxTop = top + LANE_PAD + placed.row * ROW
  const markY = top + LANE_PAD + rows * ROW + MARK / 2 - 2
  const tx = placed.anchor === 'start' ? placed.x + 7 : placed.x - 7
  const style = placed.event.major
    ? { size: SIZES.major, weight: WEIGHT.heading }
    : { size: SIZES.event, weight: WEIGHT.body }
  return [
    h('path', {
      d: `M${n(placed.x)} ${n(boxTop + 2)}V${n(markY)}`,
      stroke: sw.stroke,
      'stroke-width': placed.event.major ? 1.4 : 1,
      opacity: 0.7,
    }),
    text({
      x: tx,
      y: boxTop + 13,
      lines: [placed.name],
      ...style,
      fill: placed.event.major ? sw.strong : tokens.fg,
      anchor: placed.anchor,
      lineHeight: 0,
      shift: 0,
      valign: 'top',
    }),
    text({
      x: tx,
      y: boxTop + 28,
      lines: [placed.date],
      size: SIZES.date,
      fill: tokens.muted,
      anchor: placed.anchor,
      lineHeight: 0,
      shift: 0,
      valign: 'top',
    }),
    marker({ placed, y: markY, sw, tokens }),
  ].join('')
}

/** The heights where other events' labels sit across `x`, so a guide line can pass behind them. */
function labelGaps({
  frame,
  tops,
  guide,
}: {
  frame: Frame
  tops: number[]
  guide: PlacedEvent
}): [number, number][] {
  return frame.lanes
    .flatMap((layout, j) =>
      layout.events
        .filter((q) => q !== guide && q.box.l - 4 <= guide.x && guide.x <= q.box.r + 4)
        .map((q): [number, number] => {
          const top = tops[j] + LANE_PAD + q.row * ROW
          return [top - 2, top + ROW - 2]
        }),
    )
    .sort((a, b) => a[0] - b[0])
}

/** A vertical line from `from` to `to` at `x`, broken wherever a gap lies. */
function brokenLine({
  x,
  from,
  to,
  gaps,
}: {
  x: number
  from: number
  to: number
  gaps: [number, number][]
}): string {
  let y = from
  let d = ''
  for (const [lo, hi] of gaps) {
    if (lo > y) d += `M${n(x)} ${n(y)}V${n(Math.min(lo, to))}`
    y = Math.max(y, hi)
  }
  return y < to ? `${d}M${n(x)} ${n(y)}V${n(to)}` : d
}

function drawMajorGuides({ frame, tops }: { frame: Frame; tops: number[] }): string[] {
  return frame.lanes.flatMap((layout, index) =>
    layout.events
      .filter((p) => p.event.major)
      .map((p) => {
        const sw = itemSwatch({
          color: p.event.color,
          fallback: frame.laneSwatches[index],
          tokens: frame.ctx.tokens,
        })
        return h('path', {
          d: brokenLine({
            x: p.x,
            from: frame.lanesTop,
            to: frame.lanesBottom,
            gaps: labelGaps({ frame, tops, guide: p }),
          }),
          stroke: sw.stroke,
          'stroke-width': 1.2,
          'stroke-dasharray': '5 4',
          opacity: 0.55,
        })
      }),
  )
}

function drawLane({ frame, index, top }: { frame: Frame; index: number; top: number }) {
  const layout = frame.lanes[index]
  const fallback = frame.laneSwatches[index]
  const { tokens } = frame.ctx
  const spanTop = top + LANE_PAD + (layout.eventRows ? layout.eventRows * ROW + MARK + 10 : 0)
  const spans = layout.spans.map((span, k) =>
    drawSpan({
      frame,
      span,
      y: spanTop + span.row * (BAR + BAR_GAP),
      sw: itemSwatch({ color: span.span.color, fallback, tokens }),
      id: `mm-tl-${index}-${k}`,
    }),
  )
  const events = layout.events.map((placed) => {
    const sw = itemSwatch({ color: placed.event.color, fallback, tokens })
    return h(
      'g',
      target({ id: frame.ids.get(placed.event) ?? '', kind: 'event', tint: sw.stroke }),
      drawEvent({ frame, placed, top, rows: layout.eventRows, sw }),
    )
  })
  const spanBodies = spans.map((s, k) => {
    const { span } = layout.spans[k]
    const tint = itemSwatch({ color: span.color, fallback, tokens }).stroke
    return h('g', target({ id: frame.ids.get(span) ?? '', kind: 'span', tint }), s.body)
  })
  return {
    body: [...spanBodies, ...events].join(''),
    defs: spans.map((s) => s.defs).join(''),
  }
}

function drawAxis(frame: Frame): string[] {
  const { ctx, scale } = frame
  const { tokens } = ctx
  const y = frame.lanesBottom
  const parts = [
    h('path', {
      d: `M${n(scale.x0)} ${n(y)}H${n(scale.x1)}`,
      stroke: tokens.muted,
      'stroke-width': 1.2,
    }),
  ]
  for (const tick of frame.ticks)
    parts.push(
      h('path', { d: `M${n(tick.x)} ${n(y)}v5`, stroke: tokens.muted, 'stroke-width': 1.2 }),
      label({
        ctx,
        x: tick.x,
        y: y + 18,
        value: tick.label,
        size: SIZES.tick,
        weight: tick.major ? WEIGHT.heading : WEIGHT.body,
        fill: tick.major ? tokens.fg : tokens.muted,
        anchor: 'middle',
      }),
    )
  if (scale.kind === 'log')
    parts.push(
      label({
        ctx,
        x: scale.x1,
        y: y + 40,
        value: 'Logarithmic scale: each step left is ten times further back',
        size: 11.5,
        fill: tokens.faint,
        anchor: 'end',
      }),
    )
  return parts
}

function drawNow(frame: Frame): string[] {
  const { scale, model, ctx } = frame
  const inRange = model.now > scale.t0 && model.now < scale.t1
  if (!model.nowGiven || scale.kind === 'log' || !inRange) return []
  const x = scale.x(model.now)
  const sw = ctx.tokens.semantic.negative
  const w = ctx.text.width('Now', { size: 11, weight: WEIGHT.heading }) + 14
  return [
    h('path', {
      d: `M${n(x)} ${n(frame.lanesTop)}V${n(frame.lanesBottom)}`,
      stroke: sw.stroke,
      'stroke-width': 1.5,
      'stroke-dasharray': '4 3',
    }),
    h('path', {
      d: roundedRect({
        x: x - w / 2,
        y: frame.lanesTop - 8,
        w,
        h: 16,
        r: corner({ tokens: ctx.tokens, r: 8 }),
      }),
      fill: sw.stroke,
    }),
    label({
      ctx,
      x,
      y: frame.lanesTop,
      value: 'Now',
      size: 11,
      weight: WEIGHT.heading,
      fill: ctx.tokens.bg,
      anchor: 'middle',
    }),
  ]
}

function drawNotes({ frame, top }: { frame: Frame; top: number }) {
  const { ctx, scale } = frame
  const lines = frame.model.notes.flatMap((note) =>
    ctx.text.wrap(note, { size: SIZES.note, max: scale.x1 - frame.laneLeft }),
  )
  const lh = ctx.text.lineHeight({ size: SIZES.note })
  const body = lines.length
    ? text({
        x: frame.laneLeft,
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
  return { body, height: lines.length ? lines.length * lh + 8 : 0 }
}

/** Draws a timeline written in the extended syntax: lanes, eras, spans and events on a real axis. */
export function renderDated(model: DatedTimeline, ctx: Context): Drawing {
  const frame = buildFrame({ model, ctx })
  const tops = laneTops(frame)
  const lanes = frame.lanes.map((_, index) => drawLane({ frame, index, top: tops[index] }))
  const axisBottom = frame.lanesBottom + (frame.scale.kind === 'log' ? 50 : 32)
  const notes = drawNotes({ frame, top: axisBottom + 6 })
  const title = model.title
    ? label({
        ctx,
        x: MARGIN,
        y: frame.titleTop + 12,
        value: model.title,
        size: SIZES.title,
        weight: WEIGHT.title,
        fill: ctx.tokens.fg,
      })
    : ''
  const right = Math.max(frame.scale.x1, ...frame.lanes.map((l) => l.extent.r))
  const body = [
    ...drawEras(frame),
    ...frame.lanes.map((_, index) => drawLaneRule({ frame, index, top: tops[index] })),
    ...drawGrid(frame),
    ...drawMajorGuides({ frame, tops }),
    ...lanes.map((l) => l.body),
    ...drawAxis(frame),
    ...drawNow(frame),
    notes.body,
    drawPinned({ frame, tops, title }),
  ].join('')
  return {
    width: right + MARGIN,
    height: axisBottom + notes.height + MARGIN - 8,
    body,
    defs: lanes.map((l) => l.defs).join(''),
    title: model.title,
  }
}
