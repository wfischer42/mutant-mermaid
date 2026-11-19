import type { TextKit } from '../../core/text.ts'
import { WEIGHT } from '../../theme/index.ts'
import { blockHeight } from '../templates/common.ts'
import { type Element, isContainer, type Kind } from './model.ts'

/**
 * Box layout for wireframes. Columns stack their children at full width; rows give each child its
 * natural width and share what's left among the children that grow. Every element ends up as a
 * `Box` in screen coordinates, which the painter draws.
 */

export interface Box {
  el: Element
  x: number
  y: number
  w: number
  h: number
  align: Align
  kids: Box[]
}

export type Align = 'start' | 'center' | 'end'

export const BODY = 14

/** Font size and weight of text-like elements. */
const TYPE: Partial<Record<Kind, { size: number; weight: number }>> = {
  h1: { size: 26, weight: WEIGHT.title },
  h2: { size: 20, weight: WEIGHT.heading },
  h3: { size: 16, weight: WEIGHT.heading },
  text: { size: BODY, weight: 400 },
  link: { size: BODY, weight: WEIGHT.body },
}

/** Size and weight for a text element; `!small` steps it down and `!bold` makes it heavier. */
export function typeOf(el: Element): { size: number; weight: number } {
  const base = TYPE[el.kind] ?? { size: BODY, weight: 400 }
  const size = el.flags.has('small') ? Math.round(base.size * 0.85) : base.size
  return { size, weight: el.flags.has('bold') ? WEIGHT.title : base.weight }
}

/** Whether a field's name sits above it: when a placeholder or masked dots fill the field. */
export function captioned(el: Element): boolean {
  return Boolean(el.note) || (el.flags.has('secret') && Boolean(el.label))
}

/** What a text element stands for: its words, or a stock line when it has none. */
export function wordsOf(el: Element): string {
  return el.label || 'Lorem ipsum dolor sit amet'
}

interface Frame {
  pad: number
  padX: number
  gap: number
}

const FRAMES: Record<string, Frame> = {
  col: { pad: 0, padX: 0, gap: 12 },
  row: { pad: 0, padX: 0, gap: 12 },
  main: { pad: 24, padX: 24, gap: 16 },
  section: { pad: 14, padX: 14, gap: 12 },
  card: { pad: 16, padX: 16, gap: 12 },
  modal: { pad: 20, padX: 20, gap: 14 },
  sidebar: { pad: 16, padX: 16, gap: 8 },
  header: { pad: 12, padX: 20, gap: 20 },
  footer: { pad: 14, padX: 20, gap: 20 },
  grid: { pad: 0, padX: 0, gap: 16 },
}

/** Elements that take the full width of a column and grow to fill a row. */
const GROWS = new Set<Kind>([
  'input',
  'textarea',
  'select',
  'search',
  'image',
  'lines',
  'list',
  'table',
  'chart',
  'divider',
  'spacer',
  'tabs',
  'col',
  'main',
  'section',
  'card',
  'grid',
  'row',
  'header',
  'footer',
  'modal',
])

/** Text that fills a column's width and wraps, rather than sitting at its own width. */
const WRAPS = new Set<Kind>(['h1', 'h2', 'h3', 'text'])

const FIXED_HEIGHT: Partial<Record<Kind, number>> = {
  button: 36,
  link: 20,
  check: 22,
  radio: 22,
  toggle: 22,
  badge: 22,
  icon: 24,
  logo: 30,
  nav: 32,
  tabs: 42,
  divider: 1,
  search: 38,
}

export interface Env {
  kit: TextKit
}

function attrNumber({ el, key }: { el: Element; key: string }): number | null {
  const value = Number(el.attrs[key])
  return Number.isFinite(value) && value > 0 ? value : null
}

function grows(el: Element): boolean {
  if (attrNumber({ el, key: 'w' })) return false
  if (el.kind === 'sidebar') return false
  return GROWS.has(el.kind) || el.flags.has('grow') || el.flags.has('full')
}

function labelWidth({ env, text, size = BODY }: { env: Env; text: string; size?: number }) {
  return env.kit.width(text, { size, weight: WEIGHT.body })
}

/** The width of a nav's items laid end to end. */
function navWidth({ env, el }: { env: Env; el: Element }): number {
  const widths = el.parts.map((p) => labelWidth({ env, text: p.text }) + (p.marked ? 28 : 0))
  return widths.reduce((sum, w) => sum + w, 0) + 22 * Math.max(0, widths.length - 1)
}

function textNatural({ env, el }: { env: Env; el: Element }): number {
  return env.kit.width(wordsOf(el), typeOf(el))
}

function avatarSize(el: Element): number {
  return attrNumber({ el, key: 'size' }) ?? 36
}

/** How wide an element would like to be when nothing stretches it. */
export function natural({ env, el }: { env: Env; el: Element }): number {
  const given = attrNumber({ el, key: 'w' })
  if (given) return given
  const measures: Partial<Record<Kind, () => number>> = {
    button: () => labelWidth({ env, text: el.label || 'Button' }) + 36,
    badge: () => labelWidth({ env, text: el.label || 'New', size: 12 }) + 20,
    link: () => textNatural({ env, el }),
    check: () => labelWidth({ env, text: el.label }) + 30,
    radio: () => labelWidth({ env, text: el.label }) + 30,
    toggle: () => labelWidth({ env, text: el.label }) + 50,
    icon: () => 24,
    avatar: () => avatarSize(el) + (el.label ? labelWidth({ env, text: el.label }) + 12 : 0),
    logo: () => labelWidth({ env, text: el.label || 'Logo', size: 17 }) + 38,
    nav: () => navWidth({ env, el }),
    sidebar: () => 220,
    input: () => 180,
    search: () => 200,
    select: () => 160,
  }
  const measure = measures[el.kind]
  if (measure) return measure()
  if (WRAPS.has(el.kind)) return textNatural({ env, el })
  return 120
}

function textHeight({ env, el, w }: { env: Env; el: Element; w: number }): number {
  const type = typeOf(el)
  const lines = env.kit.wrap(wordsOf(el), { ...type, max: w })
  return blockHeight({ kit: env.kit, count: lines.length, size: type.size }) + 4
}

function imageHeight({ el, w }: { el: Element; w: number }): number {
  const ratio = attrNumber({ el, key: 'ratio' }) ?? 16 / 9
  return Math.max(48, Math.min(w / ratio, 360))
}

function linesCount(el: Element): number {
  return Math.max(1, Math.min(12, Number.parseInt(el.label, 10) || 3))
}

/** An input's box, plus a caption above it when the label and placeholder are both given. */
function fieldHeight({ el, base }: { el: Element; base: number }): number {
  return base + (captioned(el) ? 22 : 0)
}

/** The height of a widget drawn at width `w`. */
export function widgetHeight({ env, el, w }: { env: Env; el: Element; w: number }): number {
  const given = attrNumber({ el, key: 'h' })
  if (given) return given
  const fixed = FIXED_HEIGHT[el.kind]
  if (fixed) return fixed
  const heights: Partial<Record<Kind, () => number>> = {
    input: () => fieldHeight({ el, base: 38 }),
    select: () => fieldHeight({ el, base: 38 }),
    textarea: () => fieldHeight({ el, base: 96 }),
    image: () => imageHeight({ el, w }),
    avatar: () => avatarSize(el),
    lines: () => linesCount(el) * 16 - 8,
    list: () => Math.max(1, el.rows.length) * 44,
    table: () => Math.max(1, el.rows.length) * 36,
    chart: () => Math.max(120, Math.min(w * 0.5, 220)),
    spacer: () => 8,
  }
  const measure = heights[el.kind]
  if (measure) return measure()
  return textHeight({ env, el, w })
}

/** A titled container's heading, drawn as its first child. */
function heading(el: Element): Element | null {
  const titled = el.kind === 'card' || el.kind === 'section' || el.kind === 'modal'
  if (!titled || !el.label) return null
  const flags = new Set([...el.flags].filter((f) => f === 'literal'))
  return { ...el, kind: 'h3', parts: [], children: [], rows: [], flags, attrs: {} }
}

function childrenOf(el: Element): Element[] {
  const head = heading(el)
  return head ? [head, ...el.children] : el.children
}

function alignOf({ el, fallback }: { el: Element; fallback: Align }): Align {
  const value = el.attrs.align
  if (value === 'center' || value === 'end' || value === 'start') return value
  if (el.flags.has('center')) return 'center'
  return fallback
}

export interface Place {
  env: Env
  el: Element
  x: number
  y: number
  w: number
  align: Align
}

/** Lays out an element at (x, y) in a slot `w` wide. */
export function place(at: Place): Box {
  if (at.el.kind === 'grid') return placeGrid(at)
  if (isRowLike(at.el.kind)) return placeRow(at)
  if (isContainer(at.el.kind)) return placeCol(at)
  return { ...at, h: widgetHeight(at), kids: [] }
}

function isRowLike(kind: Kind): boolean {
  return kind === 'row' || kind === 'header' || kind === 'footer'
}

/** The width an element takes in a column `w` wide. */
function widthInCol({ env, el, w }: { env: Env; el: Element; w: number }): number {
  if (grows(el) || WRAPS.has(el.kind)) return w
  return Math.min(natural({ env, el }), w)
}

function offset({ align, room }: { align: Align; room: number }): number {
  if (align === 'center') return room / 2
  if (align === 'end') return room
  return 0
}

function placeCol(at: Place): Box {
  const frame = FRAMES[at.el.kind] ?? FRAMES.col
  const align = alignOf({ el: at.el, fallback: at.align })
  const inner = at.w - frame.padX * 2
  const kids: Box[] = []
  let y = at.y + frame.pad
  for (const el of childrenOf(at.el)) {
    const w = widthInCol({ env: at.env, el, w: inner })
    const x = at.x + frame.padX + offset({ align, room: inner - w })
    const box = place({ env: at.env, el, x, y, w, align })
    kids.push(box)
    y += box.h + frame.gap
  }
  const content = kids.length ? y - frame.gap - at.y : 0
  const h = Math.max(content + frame.pad, attrNumber({ el: at.el, key: 'h' }) ?? 0)
  return { ...at, align, h, kids }
}

interface Slot {
  el: Element
  w: number
}

/** Shares a row's width: fixed children keep their natural width, growing ones split the rest. */
function rowSlots({ env, el, inner }: { env: Env; el: Element; inner: number }): Slot[] {
  const frame = FRAMES[el.kind] ?? FRAMES.row
  const children = childrenOf(el)
  const gaps = frame.gap * Math.max(0, children.length - 1)
  const fixed = children.map((c) => (grows(c) ? 0 : natural({ env, el: c })))
  const used = fixed.reduce((sum, w) => sum + w, 0)
  const weights = children.map((c) => (grows(c) ? (attrNumber({ el: c, key: 'grow' }) ?? 1) : 0))
  const total = weights.reduce((sum, w) => sum + w, 0)
  const spare = inner - gaps - used
  const shrink = spare < 0 ? (inner - gaps) / Math.max(1, used) : 1
  return children.map((c, i) => {
    if (weights[i]) return { el: c, w: Math.max(40, (spare * weights[i]) / total) }
    return { el: c, w: fixed[i] * Math.min(1, shrink) }
  })
}

/**
 * Headers and footers with nothing that grows push their last child to the far edge, the way a
 * nav bar puts its menu or sign-in button on the right.
 */
function pushLast({ el, slots, spare }: { el: Element; slots: Slot[]; spare: number }): number[] {
  const bar = el.kind === 'header' || el.kind === 'footer'
  const pushes = bar && slots.length > 1 && !el.attrs.align
  return slots.map((_, i) => (pushes && i === slots.length - 1 ? Math.max(0, spare) : 0))
}

function placeRow(at: Place): Box {
  const frame = FRAMES[at.el.kind] ?? FRAMES.row
  const inner = at.w - frame.padX * 2
  const slots = rowSlots({ env: at.env, el: at.el, inner })
  const taken = slots.reduce((sum, s) => sum + s.w, 0) + frame.gap * (slots.length - 1)
  const lead = pushLast({ el: at.el, slots, spare: inner - taken })
  const align = alignOf({ el: at.el, fallback: 'start' })
  let x = at.x + frame.padX + (lead.some(Boolean) ? 0 : offset({ align, room: inner - taken }))
  const kids = slots.map((slot, i) => {
    x += lead[i]
    const box = place({ env: at.env, el: slot.el, x, y: at.y + frame.pad, w: slot.w, align })
    x += slot.w + frame.gap
    return box
  })
  const tallest = Math.max(0, ...kids.map((k) => k.h))
  const h = Math.max(tallest + frame.pad * 2, at.el.kind === 'header' ? 56 : 0)
  const fit = { top: at.y + frame.pad, h: h - frame.pad * 2 }
  return { ...at, align, h, kids: kids.map((box) => centerIn({ box, ...fit })) }
}

/**
 * Moves a row's widget down so it's centered in the row's height. Containers keep their top and
 * take the full height instead, so a sidebar or a row of cards runs to the same bottom edge.
 */
function centerIn({ box, top, h }: { box: Box; top: number; h: number }): Box {
  if (isContainer(box.el.kind)) return { ...box, h: Math.max(box.h, h) }
  return shift({ box, dy: top + (h - box.h) / 2 - box.y })
}

export function shift({ box, dy }: { box: Box; dy: number }): Box {
  if (!dy) return box
  return { ...box, y: box.y + dy, kids: box.kids.map((k) => shift({ box: k, dy })) }
}

function placeGrid(at: Place): Box {
  const frame = FRAMES.grid
  const children = childrenOf(at.el)
  const cols = Math.max(1, attrNumber({ el: at.el, key: 'cols' }) ?? Math.min(3, children.length))
  const cell = (at.w - frame.gap * (cols - 1)) / cols
  const kids: Box[] = []
  let y = at.y
  for (let start = 0; start < children.length; start += cols) {
    const row = children.slice(start, start + cols).map((el, i) => {
      const x = at.x + i * (cell + frame.gap)
      return place({ env: at.env, el, x, y, w: cell, align: at.align })
    })
    const tallest = Math.max(...row.map((b) => b.h))
    kids.push(...row.map((b) => stretch({ box: b, h: tallest })))
    y += tallest + frame.gap
  }
  return { ...at, h: Math.max(0, y - frame.gap - at.y), kids }
}

/** Gives a card in a grid row the row's full height, so neighbours line up. */
function stretch({ box, h }: { box: Box; h: number }): Box {
  return isContainer(box.el.kind) ? { ...box, h } : box
}
