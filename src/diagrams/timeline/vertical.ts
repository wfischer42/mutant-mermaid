import { roundedRect, softRect } from '../../core/geometry.ts'
import { target } from '../../core/hooks.ts'
import { h, n, text } from '../../core/svg.ts'
import type { Context, Drawing } from '../../core/types.ts'
import { corner, OUTLINE, type Swatch, WEIGHT } from '../../theme/index.ts'
import { allTimes, eraColor, fit, itemSwatch, label, laneSwatch, marker } from './dated.ts'
import { layoutEras, type PlacedEra, SIZES } from './layout.ts'
import { chooseScale, makeScale, makeTicks, type Scale, type Tick } from './scale.ts'
import { type DatedTimeline, itemIds, type TimelineItem } from './syntax.ts'
import {
  axisLength,
  DATE_STYLE,
  eventStyle,
  LABEL_X,
  layoutVLane,
  SPAN_STYLE,
  SPINE,
  V_BAR,
  type VEvent,
  type VLane,
  type VSpan,
} from './vertical-layout.ts'

const MARGIN = 28
const HEAD = 40
const PAD_TOP = 18
const ERA_W = 22
const ERA_GAP = 4
const LANE_GAP = 22
const LANE_STYLE = { size: SIZES.lane, weight: WEIGHT.heading }

interface VFrame {
  ctx: Context
  model: DatedTimeline
  /** Each event and span's id for the host app. */
  ids: Map<TimelineItem, string>
  scale: Scale
  ticks: Tick[]
  eras: PlacedEra[]
  lanes: VLane[]
  swatches: Swatch[]
  headTop: number
  axisX: number
  right: number
  bottom: number
}

function makeAxis({ model, ctx, top }: { model: DatedTimeline; ctx: Context; top: number }) {
  const times = allTimes(model)
  const kind = chooseScale({ requested: model.scale, times, now: model.now })
  const length = axisLength({ lanes: model.lanes, kit: ctx.text, length: model.length })
  const scale = makeScale({ kind, times, now: model.now, x0: top, x1: top + length })
  const height = ctx.text.lineHeight({ size: SIZES.tick })
  const ticks = makeTicks({ scale, measure: () => height })
  return { scale, ticks }
}

/** The gutter left of the axis: a strip per level of era nesting, then the tick labels. */
function gutter({ ctx, ticks, eras }: { ctx: Context; ticks: Tick[]; eras: PlacedEra[] }) {
  const levels = eras.length ? Math.max(...eras.map((e) => e.depth)) + 1 : 0
  const widest = Math.max(
    0,
    ...ticks.map((t) => ctx.text.width(t.label, { size: SIZES.tick, weight: WEIGHT.heading })),
  )
  return MARGIN + levels * (ERA_W + ERA_GAP) + widest + 14
}

function buildFrame({ model, ctx }: { model: DatedTimeline; ctx: Context }): VFrame {
  const headTop = MARGIN + (model.title ? 48 : 0)
  const { scale, ticks } = makeAxis({ model, ctx, top: headTop + HEAD + PAD_TOP })
  const eras = layoutEras({ eras: model.eras, scale })
  const axisX = gutter({ ctx, ticks, eras })
  const plot = { scale, kit: ctx.text }
  let x = axisX + 18
  const lanes = model.lanes.map((lane) => {
    const header = lane.label ? ctx.text.width(lane.label, LANE_STYLE) + 12 : 0
    const placed = layoutVLane({ lane, plot, x, header })
    x += placed.width + LANE_GAP
    return placed
  })
  return {
    ctx,
    model,
    ids: itemIds(model),
    scale,
    ticks,
    eras,
    lanes,
    swatches: model.lanes.map((lane, index) => laneSwatch({ lane, index, tokens: ctx.tokens })),
    headTop,
    axisX,
    right: x - LANE_GAP,
    bottom: Math.max(scale.x1, ...lanes.map((l) => l.bottom)),
  }
}

function eraStrip({ frame, placed, sw }: { frame: VFrame; placed: PlacedEra; sw: Swatch }) {
  const { ctx } = frame
  const x = MARGIN + placed.depth * (ERA_W + ERA_GAP)
  const height = placed.x1 - placed.x0
  const cx = x + ERA_W / 2
  const cy = placed.x0 + height / 2
  const name = fit({ ctx, value: placed.era.label, max: height - 12, size: SIZES.era })
  return [
    h('path', {
      d: roundedRect({
        x,
        y: placed.x0,
        w: ERA_W,
        h: height,
        r: corner({ tokens: ctx.tokens, r: 5 }),
      }),
      fill: sw.soft,
    }),
    name &&
      text({
        x: cx,
        y: cy,
        lines: [name],
        size: SIZES.era,
        weight: WEIGHT.heading,
        fill: sw.ink,
        lineHeight: 0,
        shift: ctx.text.baselineShift({ size: SIZES.era }),
        extra: { transform: `rotate(-90 ${n(cx)} ${n(cy)})` },
      }),
  ].join('')
}

/** Eras as bands across every lane, named in strips down the left gutter. */
function drawEras(frame: VFrame): string[] {
  const { ctx, model } = frame
  const order = frame.eras
    .map((_, i) => i)
    .sort((a, b) => frame.eras[a].depth - frame.eras[b].depth)
  return order.map((i) => {
    const placed = frame.eras[i]
    const sw = eraColor({ model, index: i, tokens: ctx.tokens })
    const x = MARGIN + placed.depth * (ERA_W + ERA_GAP) + ERA_W
    return [
      h('rect', {
        x: frame.axisX,
        y: placed.x0,
        width: frame.right - frame.axisX,
        height: placed.x1 - placed.x0,
        fill: sw.fill,
        opacity: ctx.tokens.dark ? 0.42 : 0.62,
      }),
      h('path', {
        d: `M${n(x)} ${n(placed.x0)}H${n(frame.right)}`,
        stroke: sw.stroke,
        'stroke-width': 1,
        opacity: 0.35,
      }),
      eraStrip({ frame, placed, sw }),
    ].join('')
  })
}

function drawGrid(frame: VFrame): string[] {
  const { tokens } = frame.ctx
  return frame.ticks.map((tick) =>
    h('path', {
      d: `M${n(frame.axisX)} ${n(tick.x)}H${n(frame.right)}`,
      stroke: tokens.border,
      'stroke-width': 1,
      'stroke-dasharray': tick.major ? undefined : '2 4',
      opacity: tick.major ? 0.9 : 1,
    }),
  )
}

function drawAxis(frame: VFrame): string[] {
  const { ctx, scale, axisX } = frame
  const { tokens } = ctx
  const parts = [
    h('path', {
      d: `M${n(axisX)} ${n(scale.x0)}V${n(scale.x1)}`,
      stroke: tokens.muted,
      'stroke-width': 1.2,
    }),
  ]
  for (const tick of frame.ticks)
    parts.push(
      h('path', { d: `M${n(axisX)} ${n(tick.x)}h-5`, stroke: tokens.muted, 'stroke-width': 1.2 }),
      label({
        ctx,
        x: axisX - 9,
        y: tick.x,
        value: tick.label,
        size: SIZES.tick,
        weight: tick.major ? WEIGHT.heading : WEIGHT.body,
        fill: tick.major ? tokens.fg : tokens.muted,
        anchor: 'end',
      }),
    )
  return parts
}

function drawLaneRules(frame: VFrame): string[] {
  return frame.lanes.slice(1).map((lane) =>
    h('path', {
      d: `M${n(lane.x - LANE_GAP / 2)} ${n(frame.headTop + HEAD)}V${n(frame.bottom + 8)}`,
      stroke: frame.ctx.tokens.border,
      'stroke-width': 1,
    }),
  )
}

function drawMajorGuides(frame: VFrame): string[] {
  return frame.lanes.flatMap((lane, index) =>
    lane.events
      .filter((p) => p.event.major)
      .map((p) => {
        const sw = itemSwatch({
          color: p.event.color,
          fallback: frame.swatches[index],
          tokens: frame.ctx.tokens,
        })
        return h('path', {
          d: `M${n(frame.axisX)} ${n(p.y)}H${n(frame.right)}`,
          stroke: sw.stroke,
          'stroke-width': 1.2,
          'stroke-dasharray': '5 4',
          opacity: 0.55,
        })
      }),
  )
}

/** The line from an event's marker to its label, bent where the label was nudged away. */
function leader({ x, p, sw }: { x: number; p: VEvent; sw: Swatch }): string {
  const mid = p.top + p.height / 2
  return h('path', {
    d: `M${n(x)} ${n(p.y)}H${n(x + 7)}L${n(x + LABEL_X - 6)} ${n(mid)}H${n(x + LABEL_X - 3)}`,
    stroke: sw.stroke,
    'stroke-width': p.event.major ? 1.4 : 1,
    fill: 'none',
    opacity: 0.7,
  })
}

function drawEvent({ frame, lane, p, sw }: { frame: VFrame; lane: VLane; p: VEvent; sw: Swatch }) {
  const { ctx } = frame
  const { tokens } = ctx
  const x = lane.x + SPINE
  const tx = x + LABEL_X
  const style = eventStyle(p.event)
  const lh = ctx.text.lineHeight(style)
  const last = p.lines[p.lines.length - 1] ?? ''
  return [
    leader({ x, p, sw }),
    text({
      x: tx,
      y: p.top + lh / 2 + ctx.text.baselineShift(style),
      lines: p.lines,
      ...style,
      fill: p.event.major ? sw.strong : tokens.fg,
      anchor: 'start',
      lineHeight: lh,
      shift: 0,
      valign: 'top',
    }),
    label({
      ctx,
      x: tx + ctx.text.width(last, style) + 8,
      y: p.top + (p.lines.length - 0.5) * lh,
      value: p.date,
      size: SIZES.date,
      fill: tokens.muted,
    }),
    marker({ placed: { event: p.event, x }, y: p.y, sw, tokens }),
  ].join('')
}

function isFuzzy(s: VSpan): boolean {
  const { from, to } = s.span
  return from.approximate || from.uncertain || to.approximate || to.uncertain
}

/** Fades a fuzzy span's approximate ends, top to bottom. */
function fadeMask({ id, s }: { id: string; s: VSpan }): string {
  const length = s.y1 - s.y0
  const fade = Math.min(30, length / 3) / length
  const softStart = s.span.from.approximate || s.span.from.uncertain
  const softEnd = s.span.to.approximate || s.span.to.uncertain
  const stops = [
    h('stop', { offset: 0, 'stop-color': '#fff', 'stop-opacity': softStart ? 0.05 : 1 }),
    h('stop', { offset: softStart ? fade : 0, 'stop-color': '#fff', 'stop-opacity': 1 }),
    h('stop', { offset: softEnd ? 1 - fade : 1, 'stop-color': '#fff', 'stop-opacity': 1 }),
    h('stop', { offset: 1, 'stop-color': '#fff', 'stop-opacity': softEnd ? 0.05 : 1 }),
  ]
  return (
    h('linearGradient', { id: `${id}-g`, x1: 0, x2: 0, y1: 0, y2: 1 }, ...stops) +
    h(
      'mask',
      { id, maskContentUnits: 'objectBoundingBox' },
      h('rect', { width: 1, height: 1, fill: `url(#${id}-g)` }),
    )
  )
}

function barShape({ ctx, x, s }: { ctx: Context; x: number; s: VSpan }): string {
  const box = { x, y: s.y0, w: V_BAR, h: s.y1 - s.y0 }
  const r = Math.min(ctx.tokens.look === 'organic' ? V_BAR / 2 : 4, box.h / 2)
  if (ctx.tokens.look === 'sketch') return softRect({ ...box, r, rng: ctx.rng, wobble: 0.8 })
  return roundedRect({ ...box, r: corner({ tokens: ctx.tokens, r }) })
}

function spanLabel({ ctx, x, s, sw }: { ctx: Context; x: number; s: VSpan; sw: Swatch }) {
  const lh = ctx.text.lineHeight(SPAN_STYLE)
  return [
    text({
      x,
      y: s.y0 + lh / 2 + ctx.text.baselineShift(SPAN_STYLE),
      lines: s.lines,
      ...SPAN_STYLE,
      fill: sw.strong,
      anchor: 'start',
      lineHeight: lh,
      shift: 0,
      valign: 'top',
    }),
    label({
      ctx,
      x,
      y: s.y0 + s.lines.length * lh + ctx.text.lineHeight(DATE_STYLE) / 2,
      value: s.date,
      size: SIZES.date,
      fill: ctx.tokens.muted,
    }),
  ].join('')
}

function drawSpan({
  frame,
  lane,
  s,
  sw,
  id,
}: {
  frame: VFrame
  lane: VLane
  s: VSpan
  sw: Swatch
  id: string
}) {
  const { ctx } = frame
  const x = lane.x + lane.columns[s.column]
  const fuzzy = isFuzzy(s)
  const bar = h('path', {
    d: barShape({ ctx, x, s }),
    fill: s.span.major ? sw.stroke : sw.soft,
    stroke: sw.stroke,
    'stroke-width': OUTLINE.thin,
    mask: fuzzy ? `url(#${id})` : undefined,
  })
  const ends = [s.span.from.uncertain && s.y0, s.span.to.uncertain && s.y1]
    .filter((y): y is number => typeof y === 'number')
    .map((y) =>
      h('path', {
        d: `M${n(x - 3)} ${n(y)}H${n(x + V_BAR + 3)}`,
        stroke: sw.stroke,
        'stroke-width': 1.2,
        'stroke-dasharray': '2 2',
      }),
    )
  return {
    body: [bar, ...ends, spanLabel({ ctx, x: x + V_BAR + 8, s, sw })].join(''),
    defs: fuzzy ? fadeMask({ id, s }) : '',
  }
}

function drawLane({ frame, index }: { frame: VFrame; index: number }) {
  const lane = frame.lanes[index]
  const fallback = frame.swatches[index]
  const { tokens } = frame.ctx
  const spine = lane.events.length
    ? h('path', {
        d: `M${n(lane.x + SPINE)} ${n(frame.scale.x0)}V${n(frame.scale.x1)}`,
        stroke: fallback.stroke,
        'stroke-width': 1.5,
        opacity: 0.35,
      })
    : ''
  const spans = lane.spans.map((s, k) =>
    drawSpan({
      frame,
      lane,
      s,
      sw: itemSwatch({ color: s.span.color, fallback, tokens }),
      id: `mm-tlv-${index}-${k}`,
    }),
  )
  const events = lane.events.map((p) => {
    const sw = itemSwatch({ color: p.event.color, fallback, tokens })
    return h(
      'g',
      target({ id: frame.ids.get(p.event) ?? '', kind: 'event', tint: sw.stroke }),
      drawEvent({ frame, lane, p, sw }),
    )
  })
  const spanBodies = spans.map((s, k) => {
    const { span } = lane.spans[k]
    const tint = itemSwatch({ color: span.color, fallback, tokens }).stroke
    return h('g', target({ id: frame.ids.get(span) ?? '', kind: 'span', tint }), s.body)
  })
  return {
    body: [spine, ...spanBodies, ...events].join(''),
    defs: spans.map((s) => s.defs).join(''),
  }
}

function drawNow(frame: VFrame): string[] {
  const { scale, model, ctx, axisX } = frame
  const inRange = model.now > scale.t0 && model.now < scale.t1
  if (!model.nowGiven || scale.kind === 'log' || !inRange) return []
  const y = scale.x(model.now)
  const sw = ctx.tokens.semantic.negative
  const w = ctx.text.width('Now', { size: 11, weight: WEIGHT.heading }) + 14
  return [
    h('path', {
      d: `M${n(axisX)} ${n(y)}H${n(frame.right)}`,
      stroke: sw.stroke,
      'stroke-width': 1.5,
      'stroke-dasharray': '4 3',
    }),
    h('path', {
      d: roundedRect({
        x: axisX - w / 2,
        y: y - 8,
        w,
        h: 16,
        r: corner({ tokens: ctx.tokens, r: 8 }),
      }),
      fill: sw.stroke,
    }),
    label({
      ctx,
      x: axisX,
      y,
      value: 'Now',
      size: 11,
      weight: WEIGHT.heading,
      fill: ctx.tokens.bg,
      anchor: 'middle',
    }),
  ]
}

function laneHeader({ frame, index }: { frame: VFrame; index: number }): string {
  const { ctx, headTop } = frame
  const lane = frame.lanes[index]
  const sw = frame.swatches[index]
  if (!lane.lane.label) return ''
  return (
    label({
      ctx,
      x: lane.x,
      y: headTop + 13,
      value: fit({ ctx, value: lane.lane.label, max: lane.width, size: SIZES.lane }),
      ...LANE_STYLE,
      fill: sw.strong,
    }) +
    h('path', {
      d: roundedRect({
        x: lane.x,
        y: headTop + HEAD - 14,
        w: lane.width - 8,
        h: 4,
        r: corner({ tokens: ctx.tokens, r: 2 }),
      }),
      fill: sw.stroke,
    })
  )
}

/**
 * The title and lane headers, marked to stay at the top while a long timeline scrolls. The
 * backing hides the plot passing underneath; without a viewer that moves it, it sits in place.
 */
function drawPinned({ frame, title }: { frame: VFrame; title: string }): string {
  const headers = frame.lanes.map((_, index) => laneHeader({ frame, index }))
  if (!headers.some(Boolean)) return title
  const backing = h('rect', {
    x: 0,
    y: 0,
    width: frame.right + MARGIN,
    height: frame.headTop + HEAD - 4,
    fill: frame.ctx.tokens.bg,
  })
  return h('g', { 'data-sticky': 'top' }, backing, title, ...headers)
}

function drawFooter({ frame }: { frame: VFrame }) {
  const { ctx, scale } = frame
  const log = scale.kind === 'log'
  const top = Math.max(frame.bottom, scale.x1) + (log ? 16 : 6)
  const scaleNote = log
    ? label({
        ctx,
        x: MARGIN,
        y: top + 8,
        value: 'Logarithmic scale: each step up is ten times further back',
        size: 11.5,
        fill: ctx.tokens.faint,
      })
    : ''
  const notesTop = top + (log ? 26 : 10)
  const max = Math.max(frame.right - MARGIN, 320)
  const lines = frame.model.notes.flatMap((note) => ctx.text.wrap(note, { size: SIZES.note, max }))
  const lh = ctx.text.lineHeight({ size: SIZES.note })
  const notes = lines.length
    ? text({
        x: MARGIN,
        y: notesTop + SIZES.note,
        lines,
        size: SIZES.note,
        fill: ctx.tokens.muted,
        anchor: 'start',
        lineHeight: lh,
        shift: 0,
        valign: 'top',
      })
    : ''
  return { body: scaleNote + notes, bottom: notesTop + lines.length * lh }
}

/** Draws a dated timeline with time running down the page and lanes as columns. */
export function renderVertical(model: DatedTimeline, ctx: Context): Drawing {
  const frame = buildFrame({ model, ctx })
  const lanes = frame.lanes.map((_, index) => drawLane({ frame, index }))
  const footer = drawFooter({ frame })
  const title = model.title
    ? label({
        ctx,
        x: MARGIN,
        y: MARGIN + 12,
        value: model.title,
        size: SIZES.title,
        weight: WEIGHT.title,
        fill: ctx.tokens.fg,
      })
    : ''
  const body = [
    ...drawEras(frame),
    ...drawLaneRules(frame),
    ...drawGrid(frame),
    ...drawMajorGuides(frame),
    ...lanes.map((l) => l.body),
    ...drawAxis(frame),
    ...drawNow(frame),
    footer.body,
    drawPinned({ frame, title }),
  ].join('')
  return {
    width:
      Math.max(
        frame.right,
        ctx.text.width(model.title, { size: SIZES.title, weight: WEIGHT.title }) + MARGIN,
      ) + MARGIN,
    height: footer.bottom + MARGIN,
    body,
    defs: lanes.map((l) => l.defs).join(''),
    title: model.title,
  }
}
