import type { Point } from '../../core/geometry.ts'
import { balance } from '../../core/text.ts'
import type { Context } from '../../core/types.ts'
import { WEIGHT } from '../../theme/index.ts'
import type { Flow, SystemsModel } from './model.ts'

/**
 * Stock & flow layout. Stocks sit in a row in the order flows chain them; each flow is a pipe
 * through the slot it needs (a shared pipe between neighbouring stocks, a cloud to the left for
 * an inflow, to the right for an outflow, above or below when the side is taken). Auxiliaries
 * go in tiers above the row, each over the things it influences.
 */

export const STOCK_H = 60
const PIPE = 150
const CLOUD_GAP = 26
const TIER = 108

export interface StockShape {
  id: string
  index: number
  x: number
  y: number
  w: number
  h: number
  lines: string[]
}

export type Route = 'between' | 'left' | 'right' | 'top' | 'bottom' | 'under'

export interface FlowShape {
  flow: Flow
  route: Route
  /** The pipe from source end to target end. */
  points: Point[]
  valve: Point
  vertical: boolean
  /** Cloud centers at the open ends. */
  clouds: Point[]
  /** The stock whose color the pipe takes. */
  owner: string
  lines: string[]
}

export interface AuxShape {
  id: string
  x: number
  y: number
  lines: string[]
  w: number
}

export interface StockFlowLayout {
  stocks: Map<string, StockShape>
  flows: Map<string, FlowShape>
  auxes: Map<string, AuxShape>
  row: number
}

/** Stocks in the order flows chain them: each chain from its head, then the rest. */
function stockOrder(model: SystemsModel): string[] {
  const next = (id: string) =>
    model.flows.flatMap((f) => (f.from === id && f.to !== null ? [f.to] : []))
  const fed = new Set(model.flows.flatMap((f) => (f.from !== null && f.to !== null ? [f.to] : [])))
  const out: string[] = []
  const visit = (id: string) => {
    if (out.includes(id)) return
    out.push(id)
    for (const to of next(id)) visit(to)
  }
  for (const id of model.stocks.filter((s) => !fed.has(s))) visit(id)
  for (const id of model.stocks) visit(id)
  return out
}

interface Slots {
  left: Set<string>
  right: Set<string>
}

function routeFor({ flow, order, slots }: { flow: Flow; order: string[]; slots: Slots }): Route {
  const from = flow.from === null ? -1 : order.indexOf(flow.from)
  const to = flow.to === null ? -1 : order.indexOf(flow.to)
  if (from >= 0 && to >= 0) return Math.abs(from - to) === 1 ? 'between' : 'under'
  if (to >= 0) return slots.left.has(order[to]) ? 'top' : 'left'
  return slots.right.has(order[from]) ? 'bottom' : 'right'
}

/** Decides each flow's route, claiming stock sides as it goes: stock-to-stock flows first. */
function routes({ model, order }: { model: SystemsModel; order: string[] }): Map<Flow, Route> {
  const slots: Slots = { left: new Set(), right: new Set() }
  const out = new Map<Flow, Route>()
  const between = model.flows.filter((f) => f.from !== null && f.to !== null)
  const rest = model.flows.filter((f) => f.from === null || f.to === null)
  for (const flow of [...between, ...rest]) {
    const route = routeFor({ flow, order, slots })
    out.set(flow, route)
    claim({ flow, route, order, slots })
  }
  return out
}

function claim({
  flow,
  route,
  order,
  slots,
}: {
  flow: Flow
  route: Route
  order: string[]
  slots: Slots
}): void {
  const [a, b] = [flow.from ?? '', flow.to ?? '']
  if (route === 'left') slots.left.add(b)
  if (route === 'right') slots.right.add(a)
  if (route !== 'between') return
  const [first, second] = order.indexOf(a) < order.indexOf(b) ? [a, b] : [b, a]
  slots.right.add(first)
  slots.left.add(second)
}

function measureStock({
  id,
  index,
  ctx,
  label,
}: {
  id: string
  index: number
  ctx: Context
  label: string
}): StockShape {
  const style = { size: 15, weight: WEIGHT.heading }
  const lines = balance({ kit: ctx.text, text: label, style, max: 150 })
  const textW = Math.max(...lines.map((l) => ctx.text.width(l, style)))
  const h = Math.max(STOCK_H, lines.length * ctx.text.lineHeight({ size: 15 }) + 30)
  return { id, index, x: 0, y: 0, w: Math.max(124, textW + 40), h, lines }
}

/** Places stocks left to right with room for the pipes that use each gap. */
function placeStocks({
  order,
  stocks,
  flowRoutes,
}: {
  order: string[]
  stocks: Map<string, StockShape>
  flowRoutes: Map<Flow, Route>
}): void {
  const uses = (route: Route, id: string) =>
    [...flowRoutes].some(([f, r]) => r === route && (f.from === id || f.to === id))
  let cursor = 0
  order.forEach((id, i) => {
    const stock = stocks.get(id)
    if (!stock) return
    const inLeft = uses('left', id) ? PIPE + CLOUD_GAP + 30 : 0
    const prev = i > 0 ? order[i - 1] : null
    const shared = [...flowRoutes].some(
      ([f, r]) =>
        r === 'between' &&
        prev !== null &&
        [f.from, f.to].includes(prev) &&
        [f.from, f.to].includes(id),
    )
    const prevRight = prev !== null && uses('right', prev) ? PIPE + CLOUD_GAP + 30 : 0
    const gap = shared ? PIPE + 70 : Math.max(90, prevRight + inLeft + 40)
    cursor += i === 0 ? inLeft : gap
    stock.x = cursor + stock.w / 2
    cursor += stock.w
  })
}

function pipeFor({
  flow,
  route,
  stocks,
  lane,
}: {
  flow: Flow
  route: Route
  stocks: Map<string, StockShape>
  lane: number
}): { points: Point[]; clouds: Point[] } {
  const from = flow.from ? stocks.get(flow.from) : undefined
  const to = flow.to ? stocks.get(flow.to) : undefined
  if (route === 'between' && from && to) {
    const dir = Math.sign(to.x - from.x)
    return {
      points: [
        { x: from.x + (dir * from.w) / 2, y: 0 },
        { x: to.x - (dir * to.w) / 2, y: 0 },
      ],
      clouds: [],
    }
  }
  if (route === 'under' && from && to) {
    const depth = from.h / 2 + 70 + lane * 34
    return {
      points: [
        { x: from.x, y: from.h / 2 },
        { x: from.x, y: depth },
        { x: to.x, y: depth },
        { x: to.x, y: to.h / 2 },
      ],
      clouds: [],
    }
  }
  return cloudPipe({ route, stock: to ?? from, lane })
}

function cloudPipe({
  route,
  stock,
  lane,
}: {
  route: Route
  stock: StockShape | undefined
  lane: number
}): {
  points: Point[]
  clouds: Point[]
} {
  if (!stock) return { points: [], clouds: [] }
  const shift = lane * 46
  const left = stock.x - stock.w / 2
  const right = stock.x + stock.w / 2
  const top = -stock.h / 2
  const bottom = stock.h / 2
  const table: Record<string, { points: Point[]; cloud: Point }> = {
    left: {
      points: [
        { x: left - PIPE, y: 0 },
        { x: left, y: 0 },
      ],
      cloud: { x: left - PIPE - CLOUD_GAP, y: 0 },
    },
    right: {
      points: [
        { x: right, y: 0 },
        { x: right + PIPE, y: 0 },
      ],
      cloud: { x: right + PIPE + CLOUD_GAP, y: 0 },
    },
    top: {
      points: [
        { x: stock.x + shift, y: top - PIPE + 20 },
        { x: stock.x + shift, y: top },
      ],
      cloud: { x: stock.x + shift, y: top - PIPE + 20 - CLOUD_GAP + 4 },
    },
    bottom: {
      points: [
        { x: stock.x + shift, y: bottom },
        { x: stock.x + shift, y: bottom + PIPE - 20 },
      ],
      cloud: { x: stock.x + shift, y: bottom + PIPE - 20 + CLOUD_GAP - 4 },
    },
  }
  const entry = table[route] ?? table.left
  return { points: entry.points, clouds: [entry.cloud] }
}

/** The middle of the pipe's longest straight run, where the valve sits. */
function valveOn(points: Point[]): { at: Point; vertical: boolean } {
  let best = { at: points[0] ?? { x: 0, y: 0 }, vertical: false, length: -1 }
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    if (length > best.length)
      best = {
        at: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        vertical: Math.abs(b.x - a.x) < 1,
        length,
      }
  }
  return { at: best.at, vertical: best.vertical }
}

function placeFlows({
  model,
  stocks,
  flowRoutes,
  ctx,
}: {
  model: SystemsModel
  stocks: Map<string, StockShape>
  flowRoutes: Map<Flow, Route>
  ctx: Context
}): Map<string, FlowShape> {
  const lanes = new Map<string, number>()
  const out = new Map<string, FlowShape>()
  for (const flow of model.flows) {
    const route = flowRoutes.get(flow) ?? 'left'
    const key = `${route}:${route === 'under' ? '' : (flow.to ?? flow.from)}`
    const lane = lanes.get(key) ?? 0
    lanes.set(key, lane + 1)
    const { points, clouds } = pipeFor({ flow, route, stocks, lane })
    const valve = valveOn(points)
    const label = model.labels[flow.id] ?? flow.id
    const lines = balance({
      kit: ctx.text,
      text: label,
      style: { size: 13, weight: WEIGHT.body },
      max: 120,
    })
    out.set(flow.id, {
      flow,
      route,
      points,
      valve: valve.at,
      vertical: valve.vertical,
      clouds,
      owner: flow.to ?? flow.from ?? '',
      lines,
    })
  }
  return out
}

/** Where each thing an auxiliary can point at sits, for placing auxiliaries over their targets. */
function anchorOf({
  id,
  stocks,
  flows,
}: {
  id: string
  stocks: Map<string, StockShape>
  flows: Map<string, FlowShape>
}): Point | null {
  const stock = stocks.get(id)
  if (stock) return { x: stock.x, y: 0 }
  return flows.get(id)?.valve ?? null
}

/** Pushes neighbours in a tier apart until their labels clear each other. */
function spreadTier(tier: AuxShape[]): void {
  tier.sort((left, right) => left.x - right.x)
  for (let pass = 0; pass < 80; pass++)
    for (let i = 1; i < tier.length; i++) {
      const a = tier[i - 1]
      const b = tier[i]
      const need = (a.w + b.w) / 2 + 28 - (b.x - a.x)
      if (need <= 0) continue
      a.x -= need / 2
      b.x += need / 2
    }
}

/** Tier of each auxiliary: 1 when it points at a stock or flow, one more than its target otherwise. */
function tiers({
  auxes,
  model,
  anchored,
}: {
  auxes: string[]
  model: SystemsModel
  anchored: (id: string) => boolean
}): Map<string, number> {
  const tier = new Map<string, number>()
  for (const id of auxes) tier.set(id, 1)
  for (let pass = 0; pass < auxes.length; pass++)
    for (const id of auxes) {
      const targets = model.links.filter((l) => l.from === id).map((l) => l.to)
      const direct = targets.some(anchored) || !targets.length
      const above = targets.flatMap((t) => tier.get(t) ?? [])
      tier.set(id, direct ? 1 : Math.max(1, ...above.map((t) => t + 1)))
    }
  return tier
}

function placeAuxes({
  model,
  stocks,
  flows,
  ctx,
}: {
  model: SystemsModel
  stocks: Map<string, StockShape>
  flows: Map<string, FlowShape>
  ctx: Context
}): Map<string, AuxShape> {
  const ids = model.variables.filter((id) => !stocks.has(id) && !flows.has(id))
  const anchored = (id: string) => stocks.has(id) || flows.has(id)
  const tierOf = tiers({ auxes: ids, model, anchored })
  const shapes = new Map<string, AuxShape>()
  const topClouds = Math.min(
    0,
    ...[...flows.values()].flatMap((f) => (f.route === 'top' ? f.clouds.map((c) => c.y) : [])),
  )
  const base = Math.min(-STOCK_H / 2 - 84, topClouds - 60)
  const maxTier = Math.max(1, ...tierOf.values())
  for (let level = 1; level <= maxTier; level++) {
    const tier: AuxShape[] = []
    for (const id of ids.filter((i) => tierOf.get(i) === level)) {
      const targets = model.links.filter((l) => l.from === id).map((l) => l.to)
      const sources = model.links.filter((l) => l.to === id).map((l) => l.from)
      const near = [...targets, ...(targets.length ? [] : sources)].flatMap(
        (t) => anchorOf({ id: t, stocks, flows }) ?? shapes.get(t) ?? [],
      )
      const x = near.length ? near.reduce((s, p) => s + p.x, 0) / near.length : 0
      const label = model.labels[id] ?? id
      const lines = balance({
        kit: ctx.text,
        text: label,
        style: { size: 13, weight: WEIGHT.body },
        max: 110,
      })
      const w = Math.max(
        ...lines.map((l) => ctx.text.width(l, { size: 13, weight: WEIGHT.body })),
        20,
      )
      tier.push({ id, x, y: base - (level - 1) * TIER, lines, w })
    }
    spreadTier(tier)
    for (const shape of tier) shapes.set(shape.id, shape)
  }
  return shapes
}

export function layoutStockFlow({
  model,
  ctx,
}: {
  model: SystemsModel
  ctx: Context
}): StockFlowLayout {
  const order = stockOrder(model)
  const stocks = new Map(
    order.map((id, index) => [
      id,
      measureStock({ id, index: model.stocks.indexOf(id), ctx, label: model.labels[id] ?? id }),
    ]),
  )
  const flowRoutes = routes({ model, order })
  placeStocks({ order, stocks, flowRoutes })
  const flows = placeFlows({ model, stocks, flowRoutes, ctx })
  const auxes = placeAuxes({ model, stocks, flows, ctx })
  return { stocks, flows, auxes, row: 0 }
}
