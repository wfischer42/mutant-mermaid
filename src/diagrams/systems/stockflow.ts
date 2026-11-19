import { arrowHead, type Point, roundedRect } from '../../core/geometry.ts'
import { target } from '../../core/hooks.ts'
import { g, h, n, text } from '../../core/svg.ts'
import type { Context, Drawing } from '../../core/types.ts'
import { corner, OUTLINE, pick, type Swatch, WEIGHT } from '../../theme/index.ts'
import {
  arcHeading,
  arcPath,
  arcPoint,
  arcSamples,
  arcStep,
  type CircleArc,
  circleArc,
  exitT,
} from './arcs.ts'
import { drawTitle, loopTrend, NEGATIVE_DOTS } from './cld.ts'
import { leftOf } from './cld-edges.ts'
import { crowding, inside, type Obstacles } from './cld-spots.ts'
import { chooseLoops, findCycles } from './cycles.ts'
import {
  type Badge,
  badgeSize,
  drawBadge,
  drawDelay,
  drawSign,
  LOOP_RING,
  loopSwatch,
} from './marks.ts'
import { type Link, linkIds, type NamedLoop, type SystemsModel } from './model.ts'
import {
  type AuxShape,
  type FlowShape,
  layoutStockFlow,
  type StockFlowLayout,
  type StockShape,
} from './stockflow-layout.ts'
import { type Box, bestSpot, bounds, boxAt, centroid, fitCircle, inflate, overlap, signedArea } from './vec.ts'

const AUX_R = 8
const VALVE = 11

/** The causal structure a stock & flow implies: inflows raise their stock, outflows lower it. */
export function flowLinks(model: SystemsModel): Link[] {
  const physical = model.flows.flatMap((flow) => [
    ...(flow.to
      ? [{ from: flow.id, to: flow.to, polarity: '+' as const, delay: false, line: flow.line }]
      : []),
    ...(flow.from
      ? [{ from: flow.id, to: flow.from, polarity: '-' as const, delay: false, line: flow.line }]
      : []),
  ])
  return [...model.links, ...physical]
}

interface Info {
  link: Link
  arc: CircleArc
  t0: number
  t1: number
  tip: Point
  heading: number
  samples: Point[]
  loop: LoopColor | null
}

interface LoopColor {
  loop: NamedLoop
  swatch: Swatch
  /** The circle the loop's information links follow, when it reaches off the row. */
  circle: LoopCircle | null
}

interface LoopCircle {
  center: Point
  r: number
  /** +1 when the loop runs clockwise round the center on screen. */
  sign: number
}

/** Whether a point sits on the row of stocks and valves. */
function onRow(p: Point): boolean {
  return Math.abs(p.y) < 40
}

/**
 * The circle a loop that leaves the row is drawn on, as in a causal loop diagram: through what it
 * passes off the row and the two ends of its stretch along the row, which stays a straight chord.
 */
function loopCircle({
  loop,
  links,
  layout,
  ctx,
}: {
  loop: NamedLoop
  links: Link[]
  layout: StockFlowLayout
  ctx: Context
}): LoopCircle | null {
  const ids = loop.cycle.links.map((i) => links[i].from)
  const pointsOf = () => ids.flatMap((id) => shapeBox({ id, layout })?.center ?? [])
  const before = pointsOf()
  const off = before.filter((p) => !onRow(p))
  const row = before.filter(onRow).sort((a, b) => a.x - b.x)
  const ends = row.length > 1 ? [row[0], row[row.length - 1]] : row
  const auxes = ids.flatMap((id) => layout.auxes.get(id) ?? [])
  const lone = off.length === 1 && auxes.length === 1 && ends.length === 2 ? auxes[0] : null
  const fit = lone
    ? dome({ aux: lone, ends, layout, ctx })
    : off.length
      ? fitCircle([...off, ...ends])
      : null
  if (!fit) return null
  return { ...fit, sign: signedArea(pointsOf()) >= 0 ? 1 : -1 }
}

/**
 * How high a dome over `chord` must rise, from `base`, to pass over the tops of the auxes under
 * it (each `dx` from the middle and `height` from the row, name included), so no link of theirs
 * crosses the loop.
 */
function domeRise({
  chord,
  base,
  tops,
}: {
  chord: number
  base: number
  tops: { dx: number; height: number }[]
}): number {
  const clears = (rise: number) => {
    const r = (chord * chord) / 4 / (2 * rise) + rise / 2
    return tops.every(({ dx, height }) => Math.sqrt(Math.max(0, r * r - dx * dx)) - (r - rise) >= height)
  }
  let rise = base
  while (!clears(rise) && rise < chord * 2) rise += 4
  return rise
}

/**
 * The circle for a loop that leaves the row through one aux: as low over its stretch of row as
 * the aux's tier allows, with the aux moved onto it, as near the top as its name stays clear of
 * the other auxes.
 */
function dome({
  aux,
  ends,
  layout,
  ctx,
}: {
  aux: AuxShape
  ends: Point[]
  layout: StockFlowLayout
  ctx: Context
}): { center: Point; r: number } {
  const [left, right] = ends
  const chord = right.x - left.x
  const dir = aux.y < 0 ? -1 : 1
  const under = [...layout.auxes.values()].filter(
    (a) => a !== aux && a.x > left.x && a.x < right.x && Math.sign(a.y) === dir,
  )
  const rise = domeRise({
    chord,
    base: Math.max(Math.abs(aux.y), chord * 0.2),
    tops: under.map((a) => {
      const label = auxLabelBox({ aux: a, side: 'above', ctx })
      return { dx: a.x - (left.x + right.x) / 2, height: Math.abs(a.y - label.y) + Math.abs(a.y) + 14 }
    }),
  })
  const r = (chord * chord) / 4 / (2 * rise) + rise / 2
  const center = { x: (left.x + right.x) / 2, y: dir * (rise - r) }
  const others = [...layout.auxes.values()]
    .filter((a) => a !== aux)
    .flatMap((a) => [auxLabelBox({ aux: a, side: 'above', ctx }), boxAt({ center: a, w: 20, h: 20 })])
  const top = Math.atan2(dir, 0)
  for (let k = 0; k < 24; k++) {
    const angle = top + (k % 2 ? -1 : 1) * Math.ceil(k / 2) * 0.06
    const p = { x: center.x + Math.cos(angle) * r, y: center.y + Math.sin(angle) * r }
    const moved = { ...aux, x: p.x, y: p.y }
    const box = inflate({ box: auxLabelBox({ aux: moved, side: 'above', ctx }), pad: 6 })
    const inside = p.x > left.x + 30 && p.x < right.x - 30 && Math.abs(p.y) > 60
    if (inside && others.every((b) => overlap({ a: box, b }) === 0)) {
      aux.x = p.x
      aux.y = p.y
      break
    }
  }
  return { center, r }
}

/**
 * The arc from `from` to `to` along a loop's circle, the way the loop runs. */
function alongCircle({ from, to, circle }: { from: Point; to: Point; circle: LoopCircle }): CircleArc {
  const { center, r, sign } = circle
  const a = Math.atan2(from.y - center.y, from.x - center.x)
  const b = Math.atan2(to.y - center.y, to.x - center.x)
  let span = sign * (b - a)
  while (span < 0) span += Math.PI * 2
  while (span >= Math.PI * 2) span -= Math.PI * 2
  const mid = a + (sign * span) / 2
  const bow = { x: center.x + Math.cos(mid) * r, y: center.y + Math.sin(mid) * r }
  const left = leftOf({ a: from, b: to, p: bow }) > 0
  return circleArc({ from, to, r, left, major: span > Math.PI })
}

/**
 * The box a thing occupies, for attaching information links, and the point links aim at. A flow's
 * is its valve: its name is placed afterwards, clear of the links (see `valveLabels`).
 */
function shapeBox({ id, layout }: { id: string; layout: StockFlowLayout }): {
  box: Box
  center: Point
} | null {
  const stock = layout.stocks.get(id)
  if (stock) return { box: boxAt({ center: stock, w: stock.w, h: stock.h }), center: stock }
  const flow = layout.flows.get(id)
  if (flow) return { box: flowBox(flow), center: flow.valve }
  const aux = layout.auxes.get(id)
  return aux
    ? { box: boxAt({ center: aux, w: AUX_R * 2 + 2, h: AUX_R * 2 + 2 }), center: aux }
    : null
}

function flowBox(flow: FlowShape): Box {
  return boxAt({ center: flow.valve, w: VALVE * 2 + 4, h: VALVE * 2 + 4 })
}

/** How far a loop along the row dips below it: room for its marker between stock and arc. */
const DIP = 112

/**
 * A loop link between two things on the row, as a circle reaching `DIP` below it: past a half
 * circle when the two are close, so a short loop still holds its marker, as a kissing circle
 * does in a causal loop diagram.
 */
function dip({ from, to, left }: { from: Point; to: Point; left: boolean }): CircleArc {
  const d = Math.hypot(to.x - from.x, to.y - from.y)
  const r = (d * d) / (8 * DIP) + DIP / 2
  return circleArc({ from, to, r, left, major: DIP > r })
}

/**
 * Where a loop dipping under the row leaves or meets a stock: on its bottom edge, a quarter of
 * the way in from the side facing the other end, so loops on both sides of a stock stay apart.
 */
function underside({ id, toward, layout }: { id: string; toward: Point; layout: StockFlowLayout }): Point | null {
  const stock = layout.stocks.get(id)
  if (!stock) return null
  const side = toward.x < stock.x ? -1 : 1
  return { x: stock.x + (side * stock.w) / 4, y: stock.y + stock.h / 2 }
}

/** An information link: a thin arc, bowing below the row when it joins two things on it. */
function infoArc({
  link,
  layout,
  middle,
  loop,
}: {
  link: Link
  layout: StockFlowLayout
  middle: Point
  loop: LoopColor | null
}): Info | null {
  const a = shapeBox({ id: link.from, layout })
  const b = shapeBox({ id: link.to, layout })
  if (!a || !b || link.from === link.to) return null
  const from = a.center
  const to = b.center
  const d = Math.hypot(to.x - from.x, to.y - from.y)
  const flat = onRow(from) && onRow(to)
  const below = { x: (from.x + to.x) / 2, y: Math.max(from.y, to.y) + 100 }
  const left = flat
    ? leftOf({ a: from, b: to, p: below }) > 0
    : leftOf({ a: from, b: to, p: middle }) < 0
  const circle = flat ? null : loop?.circle
  const arc = circle
    ? alongCircle({ from, to, circle })
    : flat && loop
      ? dip({ from: underside({ id: link.from, toward: to, layout }) ?? from, to: underside({ id: link.to, toward: from, layout }) ?? to, left })
      : circleArc({ from, to, r: flat ? d * 0.5 : d * 1.25, left })
  const t0 = exitT({ arc, box: inflate({ box: a.box, pad: 3 }), from: 0, to: 1 })
  const tipT = exitT({ arc, box: inflate({ box: b.box, pad: 2 }), from: 1, to: 0 })
  return {
    link,
    arc,
    t0,
    t1: Math.max(t0, tipT - arcStep({ arc, distance: 4 })),
    tip: arcPoint({ arc, t: tipT }),
    heading: arcHeading({ arc, t: tipT }),
    samples: arcSamples({ arc, t0, t1: tipT }),
    loop,
  }
}

function stockSwatch({
  id,
  layout,
  ctx,
}: {
  id: string
  layout: StockFlowLayout
  ctx: Context
}): Swatch {
  return pick({ tokens: ctx.tokens, index: layout.stocks.get(id)?.index ?? 0 })
}

function drawStock({ stock, ctx }: { stock: StockShape; ctx: Context }): string {
  const sw = pick({ tokens: ctx.tokens, index: stock.index })
  const x = stock.x - stock.w / 2
  const y = stock.y - stock.h / 2
  const r = corner({ tokens: ctx.tokens, r: 7 })
  const level = y + stock.h * 0.64
  const tank = `M${n(x)} ${n(level)}H${n(x + stock.w)}V${n(y + stock.h - r)}A${r} ${r} 0 0 1 ${n(x + stock.w - r)} ${n(y + stock.h)}H${n(x + r)}A${r} ${r} 0 0 1 ${n(x)} ${n(y + stock.h - r)}Z`
  const size = 15
  return h(
    'g',
    { ...target({ id: stock.id, kind: 'stock', tint: sw.stroke }), class: 'stock' },
    h('path', { d: roundedRect({ x, y, w: stock.w, h: stock.h, r }), fill: sw.fill }),
    h('path', { d: tank, fill: sw.soft }),
    h('path', {
      d: roundedRect({ x, y, w: stock.w, h: stock.h, r }),
      fill: 'none',
      stroke: sw.stroke,
      'stroke-width': OUTLINE.thin,
    }),
    text({
      x: stock.x,
      y: stock.y - 3,
      lines: stock.lines,
      size,
      weight: WEIGHT.heading,
      fill: sw.ink,
      lineHeight: ctx.text.lineHeight({ size }),
      shift: ctx.text.baselineShift({ size }),
    }),
  )
}

const PUFFS: [number, number, number][] = [
  [-13, 3, 9],
  [-4, -5, 11],
  [9, -3, 10],
  [15, 5, 8],
  [0, 6, 9],
]

/** A source or sink: a little cloud of overlapping puffs with one outline. */
function drawCloud({ at, ctx }: { at: Point; ctx: Context }): string {
  const { tokens } = ctx
  const puff = (extra: Record<string, string | number>) =>
    PUFFS.map(([dx, dy, r]) => h('circle', { cx: at.x + dx, cy: at.y + dy, r, ...extra })).join('')
  return h(
    'g',
    { class: 'cloud' },
    puff({ fill: tokens.faint, stroke: tokens.faint, 'stroke-width': 3 }),
    puff({ fill: tokens.surface }),
  )
}

/** Points every 8px along a polyline, for collision checks against pipes. */
function densify(points: Point[]): Point[] {
  return points.flatMap((p, i) => {
    if (!i) return [p]
    const a = points[i - 1]
    const steps = Math.max(1, Math.ceil(Math.hypot(p.x - a.x, p.y - a.y) / 8))
    return Array.from({ length: steps }, (_, s) => ({
      x: a.x + ((p.x - a.x) * (s + 1)) / steps,
      y: a.y + ((p.y - a.y) * (s + 1)) / steps,
    }))
  })
}

function pipePath(points: Point[]): string {
  return points.map((p, i) => `${i ? 'L' : 'M'}${n(p.x)} ${n(p.y)}`).join('')
}

/** Shortens the last segment of a polyline by `by`. */
function shorten({ points, by }: { points: Point[]; by: number }): Point[] {
  const last = points[points.length - 1]
  const prev = points[points.length - 2]
  const length = Math.hypot(last.x - prev.x, last.y - prev.y) || 1
  const k = Math.max(0, length - by) / length
  return [
    ...points.slice(0, -1),
    { x: prev.x + (last.x - prev.x) * k, y: prev.y + (last.y - prev.y) * k },
  ]
}

/** A flow: a double-line pipe ending in an arrow, a bowtie valve, and its name. */
function drawFlow({
  flow,
  sw,
  label: spot,
  ctx,
}: {
  flow: FlowShape
  sw: Swatch
  label: Box
  ctx: Context
}): string {
  const { tokens, text: kit } = ctx
  if (flow.points.length < 2) return ''
  const last = flow.points[flow.points.length - 1]
  const prev = flow.points[flow.points.length - 2]
  const angle = Math.atan2(last.y - prev.y, last.x - prev.x)
  const body = shorten({ points: flow.points, by: 12 })
  const d = pipePath(body)
  const { valve: v, vertical } = flow
  const s = VALVE
  const bowtie = vertical
    ? `M${n(v.x - s)} ${n(v.y - s)}H${n(v.x + s)}L${n(v.x)} ${n(v.y)}ZM${n(v.x - s)} ${n(v.y + s)}H${n(v.x + s)}L${n(v.x)} ${n(v.y)}Z`
    : `M${n(v.x - s)} ${n(v.y - s)}V${n(v.y + s)}L${n(v.x)} ${n(v.y)}ZM${n(v.x + s)} ${n(v.y - s)}V${n(v.y + s)}L${n(v.x)} ${n(v.y)}Z`
  const size = 13
  const lh = kit.lineHeight({ size })
  const label = vertical
    ? { x: spot.x, y: spot.y + spot.h / 2, anchor: 'start' as const }
    : { x: spot.x + spot.w / 2, y: spot.y + spot.h / 2, anchor: 'middle' as const }
  return h(
    'g',
    { ...target({ id: flow.flow.id, kind: 'flow', tint: sw.stroke }), class: 'flow' },
    h('path', {
      d,
      fill: 'none',
      stroke: sw.stroke,
      'stroke-width': 11,
      'stroke-linejoin': 'round',
    }),
    h('path', {
      d,
      fill: 'none',
      stroke: tokens.bg,
      'stroke-width': 5.5,
      'stroke-linejoin': 'round',
    }),
    h('path', { d: arrowHead({ tip: last, angle, size: 19 }), fill: sw.stroke }),
    h('path', {
      d: bowtie,
      fill: sw.fill,
      stroke: sw.strong,
      'stroke-width': 1.8,
      'stroke-linejoin': 'round',
    }),
    h('circle', { cx: v.x, cy: v.y, r: 3, fill: sw.strong }),
    text({
      x: label.x,
      y: label.y,
      lines: flow.lines,
      size,
      weight: WEIGHT.body,
      fill: tokens.fg,
      anchor: label.anchor,
      lineHeight: lh,
      shift: kit.baselineShift({ size }),
    }),
  )
}

/** Where an aux's name goes: above it, or beside it, outside the loop circle it sits on. */
type AuxSide = 'above' | 'left' | 'right'

function auxLabelBox({ aux, side, ctx }: { aux: AuxShape; side: AuxSide; ctx: Context }): Box {
  const lh = ctx.text.lineHeight({ size: 13 })
  const hgt = aux.lines.length * lh
  if (side === 'left') return { x: aux.x - AUX_R - 6 - aux.w, y: aux.y - hgt / 2, w: aux.w, h: hgt }
  if (side === 'right') return { x: aux.x + AUX_R + 6, y: aux.y - hgt / 2, w: aux.w, h: hgt }
  return { x: aux.x - aux.w / 2 - 3, y: aux.y - AUX_R - 6 - hgt, w: aux.w + 6, h: hgt }
}

/** Aux names that move beside their dot: those on a loop circle, to the side away from its middle. */
function auxSides({ loops, layout }: { loops: LoopColor[]; layout: StockFlowLayout }) {
  const sides = new Map<string, AuxSide>()
  for (const { loop, circle } of loops)
    for (const id of loop.cycle.nodes) {
      const aux = layout.auxes.get(id)
      if (aux && circle && !sides.has(id)) sides.set(id, sideOn({ aux, circle }))
    }
  return sides
}

function sideOn({ aux, circle }: { aux: AuxShape; circle: LoopCircle }): AuxSide {
  const dx = aux.x - circle.center.x
  if (Math.abs(dx) < circle.r * 0.5 && aux.y < circle.center.y) return 'above'
  return dx < 0 ? 'left' : 'right'
}

function drawAux({ aux, side, ctx }: { aux: AuxShape; side: AuxSide; ctx: Context }): string {
  const { tokens, text: kit } = ctx
  const size = 13
  const box = auxLabelBox({ aux, side, ctx })
  const anchors = { above: 'middle', left: 'end', right: 'start' } as const
  return h(
    'g',
    { ...target({ id: aux.id, kind: 'aux', tint: tokens.muted }), class: 'aux' },
    h('circle', {
      cx: aux.x,
      cy: aux.y,
      r: AUX_R,
      fill: tokens.surface,
      stroke: tokens.muted,
      'stroke-width': OUTLINE.thin,
    }),
    text({
      x: { above: aux.x, left: box.x + box.w, right: box.x }[side],
      y: box.y + box.h / 2,
      anchor: anchors[side],
      lines: aux.lines,
      size,
      weight: WEIGHT.body,
      fill: tokens.fg,
      lineHeight: kit.lineHeight({ size }),
      shift: kit.baselineShift({ size }),
    }),
  )
}

function drawInfo({ info, id, ctx }: { info: Info; id: string; ctx: Context }): string {
  const stroke = info.loop?.swatch.stroke ?? ctx.tokens.muted
  const strong = info.loop?.swatch.strong ?? ctx.tokens.muted
  const t = (info.t0 + info.t1) / 2
  const negative = info.link.polarity === '-'
  return h(
    'g',
    { ...target({ id, kind: 'link', tint: stroke }), class: 'info' },
    h('path', {
      d: arcPath({ arc: info.arc, t0: info.t0, t1: info.t1 }),
      fill: 'none',
      stroke,
      'stroke-width': negative ? 2.4 : 1.6,
      'stroke-linecap': 'round',
      'stroke-dasharray': negative ? NEGATIVE_DOTS : undefined,
    }),
    h('path', { d: arrowHead({ tip: info.tip, angle: info.heading, size: 9 }), fill: strong }),
    info.link.delay &&
      drawDelay({
        at: arcPoint({ arc: info.arc, t }),
        heading: arcHeading({ arc: info.arc, t }),
        color: strong,
        tokens: ctx.tokens,
      }),
  )
}

/** Loops through stocks, flows and information links whose polarity is known, with their warnings. */
export function analyseStockFlow(model: SystemsModel) {
  const links = flowLinks(model)
  const cycles = findCycles({ nodes: model.variables, links })
  return { links, ...chooseLoops({ cycles, links, decls: model.loops }) }
}

function stockLoops({
  model,
  layout,
  ctx,
}: {
  model: SystemsModel
  layout: StockFlowLayout
  ctx: Context
}): {
  links: Link[]
  loops: LoopColor[]
} {
  const { links, loops } = analyseStockFlow(model)
  return {
    links,
    loops: loops.map((loop) => ({
      loop,
      swatch: loopSwatch({ tokens: ctx.tokens, kind: loop.kind }),
      circle: loopCircle({ loop, links, layout, ctx }),
    })),
  }
}

/** Points along everything a loop passes through, to find its middle. */
function loopTrace({
  loop,
  links,
  infos,
  layout,
}: {
  loop: NamedLoop
  links: Link[]
  infos: Info[]
  layout: StockFlowLayout
}): Point[] {
  return loop.cycle.links.flatMap((i) => {
    const link = links[i]
    const info = infos.find((x) => x.link === link)
    if (info) return info.samples
    const flow = layout.flows.get(link.from)
    const stock = layout.stocks.get(link.to)
    return flow && stock
      ? [flow.valve, { x: (flow.valve.x + stock.x) / 2, y: (flow.valve.y + stock.y) / 2 }]
      : []
  })
}

/**
 * Puts each loop's marker, a disc holding its trend sketch, inside the loop where it's clear: the
 * disc must stay off everything, while its name may run over a little.
 */
function placeLoopMarks({
  loops,
  links,
  infos,
  layout,
  obstacles,
  model,
  ctx,
}: {
  loops: LoopColor[]
  links: Link[]
  infos: Info[]
  layout: StockFlowLayout
  obstacles: Obstacles
  model: SystemsModel
  ctx: Context
}): { badge: Badge; at: Point; box: Box }[] {
  return loops.map(({ loop, swatch, circle }) => {
    const trace = loopTrace({ loop, links, infos, layout })
    const badge: Badge = {
      tag: loop.tag,
      name: loop.name ? [loop.name] : [],
      clockwise: true,
      swatch,
      trend: model.trends[loop.tag] ?? loopTrend({ loop, links }),
    }
    const size = badgeSize({ badge, kit: ctx.text, size: 12.5 })
    const boxOf = (p: Point) => ({ x: p.x - size.w / 2, y: p.y - size.above, w: size.w, h: size.h })
    const disc = (p: Point) => boxAt({ center: p, w: LOOP_RING * 2 + 12, h: LOOP_RING * 2 + 12 })
    const at = bestSpot({
      center: centroid(trace),
      cost: (p) =>
        (inside({ p, polygon: trace }) ? 0 : 200) +
        crowding({ box: disc(p), obstacles }) * 3 +
        crowding({ box: boxOf(p), obstacles: { boxes: obstacles.boxes, points: [] } }) * 0.5 +
        crowding({ box: boxOf(p), obstacles: { boxes: [], points: obstacles.points } }) * 0.2,
      step: 6,
      rings: 18,
    })
    badge.clockwise = circle ? circle.sign > 0 : signedArea(trace) >= 0
    const box = boxOf(at)
    obstacles.boxes.push(box)
    return { badge, at, box }
  })
}

/**
 * Where each valve's name goes, once the links into it are drawn: under the valve unless a link
 * or something else is there, then above, then to either side of it, taking the clearest. A
 * vertical pipe's name sits to the right of its valve. Each name placed blocks those after it.
 */
function valveLabels({
  flows,
  obstacles,
  ctx,
}: {
  flows: FlowShape[]
  obstacles: Obstacles
  ctx: Context
}): Box[] {
  const { text: kit } = ctx
  const lh = kit.lineHeight({ size: 13 })
  const placed: Box[] = []
  return flows.map((f) => {
    const w = Math.max(...f.lines.map((l) => kit.width(l, { size: 13, weight: WEIGHT.body })))
    const hgt = f.lines.length * lh
    const { x, y } = f.valve
    const near = VALVE + 7
    const options = f.vertical
      ? [{ x: x + VALVE + 9, y: y - hgt / 2, w, h: hgt }]
      : [
          { x: x - w / 2, y: y + near, w, h: hgt },
          { x: x - w / 2, y: y - near - hgt, w, h: hgt },
          { x: x + VALVE, y: y + near - 3, w, h: hgt },
          { x: x - VALVE - w, y: y + near - 3, w, h: hgt },
          { x: x + VALVE, y: y - near - hgt + 3, w, h: hgt },
          { x: x - VALVE - w, y: y - near - hgt + 3, w, h: hgt },
        ]
    const crowd = { boxes: [...obstacles.boxes, ...placed], points: obstacles.points }
    const costs = options.map((box, i) => crowding({ box: inflate({ box, pad: 2 }), obstacles: crowd }) + i * 4)
    const best = options[costs.indexOf(Math.min(...costs))]
    placed.push(best)
    return best
  })
}

/** Renders a stock & flow diagram. */
export function renderStockFlow(model: SystemsModel, ctx: Context): Drawing {
  const { tokens, text: kit } = ctx
  const layout = layoutStockFlow({ model, ctx })
  const { links, loops } = stockLoops({ model, layout, ctx })
  const ownerOf = (link: Link) =>
    loops.find((l) => l.loop.cycle.links.some((i) => links[i] === link)) ?? null
  const middle = centroid([...layout.stocks.values()])
  const linkId = linkIds(model.links)
  const ids = new Map(model.links.map((link, i) => [link, linkId[i]]))
  const infos = model.links.flatMap(
    (link) => infoArc({ link, layout, middle, loop: ownerOf(link) }) ?? [],
  )
  const sides = auxSides({ loops, layout })
  const flowList = [...layout.flows.values()]
  const auxList = [...layout.auxes.values()]
  const stockBoxes = [...layout.stocks.values()].map((s) => boxAt({ center: s, w: s.w, h: s.h }))
  const cloudBoxes = flowList.flatMap((f) =>
    f.clouds.map((c) => boxAt({ center: c, w: 48, h: 34 })),
  )
  const auxBoxes = auxList.flatMap((a) => [
    auxLabelBox({ aux: a, side: sides.get(a.id) ?? 'above', ctx }),
    boxAt({ center: a, w: AUX_R * 2, h: AUX_R * 2 }),
  ])
  const pipeSamples = flowList.flatMap((f) => densify(f.points))
  const lines = [...infos.flatMap((i) => i.samples), ...pipeSamples]
  const fixed = [...stockBoxes, ...cloudBoxes, ...auxBoxes, ...flowList.map(flowBox)]
  const labels = valveLabels({ flows: flowList, obstacles: { boxes: fixed, points: lines }, ctx })
  const obstacles: Obstacles = { boxes: [...fixed, ...labels], points: lines }
  const marks = placeLoopMarks({ loops, links, infos, layout, obstacles, model, ctx })
  const signs = infos.map((info) => {
    const back = Math.max(info.t0, info.t1 - arcStep({ arc: info.arc, distance: 12 }))
    const p = arcPoint({ arc: info.arc, t: back })
    const radial = {
      x: (p.x - info.arc.center.x) / info.arc.r,
      y: (p.y - info.arc.center.y) / info.arc.r,
    }
    const options = [11, -11].map((k) => ({ x: p.x + radial.x * k, y: p.y + radial.y * k }))
    const costs = options.map((o) =>
      crowding({ box: boxAt({ center: o, w: 15, h: 15 }), obstacles }),
    )
    return options[costs[0] <= costs[1] ? 0 : 1]
  })
  const frame = bounds({
    boxes: [...obstacles.boxes, ...marks.map((m) => m.box)],
    points: obstacles.points,
  })
  const margin = 30
  const top = model.title ? 66 : margin
  const titleW = model.title ? kit.width(model.title, { size: 20, weight: WEIGHT.title }) : 0
  const width = Math.max(frame.w, titleW) + margin * 2
  const dx = margin - frame.x + (width - margin * 2 - frame.w) / 2
  const signMarks = infos.map((info, i) =>
    info.link.polarity === '?'
      ? ''
      : drawSign({
          polarity: info.link.polarity,
          at: signs[i],
          color: info.loop?.swatch.strong ?? tokens.fg,
          tokens,
          kit,
        }),
  )
  const body =
    drawTitle({ title: model.title, width, ctx }) +
    g(
      { x: dx, y: top - frame.y },
      h(
        'g',
        { class: 'clouds' },
        ...flowList.flatMap((f) => f.clouds.map((c) => drawCloud({ at: c, ctx }))),
      ),
      h(
        'g',
        { class: 'flows' },
        ...flowList.map((f) =>
          drawFlow({
            flow: f,
            sw: stockSwatch({ id: f.owner, layout, ctx }),
            label: labels[flowList.indexOf(f)],
            ctx,
          }),
        ),
      ),
      h(
        'g',
        { class: 'stocks' },
        ...[...layout.stocks.values()].map((s) => drawStock({ stock: s, ctx })),
      ),
      h(
        'g',
        { class: 'infos' },
        ...infos.map((info) => drawInfo({ info, id: ids.get(info.link) ?? '', ctx })),
      ),
      h('g', { class: 'auxes' }, ...auxList.map((a) => drawAux({ aux: a, side: sides.get(a.id) ?? 'above', ctx }))),
      h(
        'g',
        { class: 'loops' },
        ...marks.map((m) => drawBadge({ badge: m.badge, at: m.at, kit, tokens })),
      ),
      h('g', { class: 'signs' }, ...signMarks),
    )
  return { width, height: top + frame.h + margin, body, title: model.title }
}
