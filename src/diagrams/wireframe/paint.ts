import { roundedRect } from '../../core/geometry.ts'
import { slug, target, uniqueIds } from '../../core/hooks.ts'
import { g, h, n } from '../../core/svg.ts'
import type { Context } from '../../core/types.ts'
import { OUTLINE, WEIGHT } from '../../theme/index.ts'
import { sayer } from '../templates/common.ts'
import { type Box, captioned, typeOf, wordsOf } from './layout.ts'
import type { Element, Kind, Part } from './model.ts'

/**
 * Draws laid-out wireframe boxes as placeholders, not as a mock-up: containers are outlined boxes,
 * content text is grey bars the length of the words it stands for, and widgets are the plainest
 * marks that still say what they are. Words appear only where they name an action or a place:
 * button and link labels, field captions, nav items, tabs and checkbox labels. A quoted label,
 * `text "Free trial"`, is shown as written.
 */

export interface Paint {
  ctx: Context
  box: Box
  /** Each element's id for the host app, from elementIds. */
  ids: Map<Element, string>
}

type Painter = (p: Paint) => string

interface Area {
  x: number
  y: number
  w: number
  h: number
}

const LABEL = 13

/** The handful of greys every mark is drawn from. */
function ink(p: Paint) {
  const { tokens } = p.ctx
  return {
    line: tokens.faint,
    edge: tokens.border,
    bar: tokens.border,
    strong: tokens.faint,
    word: tokens.muted,
    fill: tokens.sunken,
  }
}

function outline({
  area,
  r,
  stroke,
  fill = 'none',
  dash,
}: {
  area: Area
  r: number
  stroke: string
  fill?: string
  dash?: string
}): string {
  return h('path', {
    d: roundedRect({ ...area, r }),
    fill,
    stroke,
    'stroke-width': OUTLINE.thin,
    'stroke-dasharray': dash,
  })
}

function stroke({ d, color, width = 1.3 }: { d: string; color: string; width?: number }): string {
  return h('path', {
    d,
    stroke: color,
    'stroke-width': width,
    fill: 'none',
    'stroke-linecap': 'round',
  })
}

/** A bar standing in for a line of text, centered on `cy`. */
function bar({
  x,
  cy,
  w,
  size,
  fill,
}: {
  x: number
  cy: number
  w: number
  size: number
  fill: string
}) {
  const thick = Math.max(5, size * 0.5)
  return h('rect', {
    x,
    y: cy - thick / 2,
    width: Math.max(thick, w),
    height: thick,
    rx: thick / 2,
    fill,
  })
}

function words({
  p,
  text,
  x,
  cy,
  anchor = 'start',
  fill,
}: {
  p: Paint
  text: string
  x: number
  cy: number
  anchor?: 'start' | 'middle' | 'end'
  fill?: string
}): string {
  return sayer(p.ctx.text)({
    x,
    y: cy,
    lines: [text],
    size: LABEL,
    weight: WEIGHT.body,
    fill: fill ?? ink(p).word,
    anchor,
  })
}

function startX({ box, w }: { box: Box; w: number }): number {
  if (box.align === 'center') return box.x + (box.w - w) / 2
  if (box.align === 'end') return box.x + box.w - w
  return box.x
}

function barTone({ p, el }: { p: Paint; el: Element }): string {
  const heading = el.kind === 'h1' || el.kind === 'h2' || el.kind === 'h3'
  const light = el.flags.has('light') || el.flags.has('muted')
  const strong = (heading || el.flags.has('bold')) && !light
  return strong ? ink(p).strong : ink(p).bar
}

/** Shown verbatim: a wrapped block of real words. */
function literal(p: Paint): string {
  const { box } = p
  const type = typeOf(box.el)
  const kit = p.ctx.text
  const lines = kit.wrap(box.el.label, { ...type, max: box.w })
  const anchors = { start: box.x, center: box.x + box.w / 2, end: box.x + box.w }
  const anchor = box.align === 'center' ? 'middle' : box.align
  return sayer(kit)({
    x: anchors[box.align],
    y: box.y + 2 + type.size * 0.55 + kit.baselineShift({ size: type.size }),
    lines,
    size: type.size,
    weight: type.weight,
    fill: p.ctx.tokens.muted,
    anchor,
    valign: 'top',
  })
}

/** Text as grey bars, one per wrapped line, each as long as the words it replaces. */
function paintText(p: Paint): string {
  const { box } = p
  if (box.el.flags.has('literal')) return literal(p)
  const type = typeOf(box.el)
  const kit = p.ctx.text
  const lines = kit.wrap(wordsOf(box.el), { ...type, max: box.w })
  const fill = barTone({ p, el: box.el })
  const marks = lines.map((line, i) => {
    const w = Math.min(box.w, kit.width(line, type))
    const cy = box.y + 2 + type.size * 0.55 + i * kit.lineHeight(type)
    return bar({ x: startX({ box, w }), cy, w, size: type.size, fill })
  })
  return g({}, ...marks)
}

function paintLines(p: Paint): string {
  const { box } = p
  const count = Math.round((box.h + 8) / 16)
  const marks = Array.from({ length: count }, (_, i) => {
    const w = i === count - 1 && count > 1 ? box.w * 0.6 : box.w
    return bar({ x: box.x, cy: box.y + 4 + i * 16, w, size: 14, fill: ink(p).bar })
  })
  return g({}, ...marks)
}

function paintLink(p: Paint): string {
  const { box } = p
  const w = p.ctx.text.width(box.el.label, { size: LABEL, weight: WEIGHT.body })
  const cy = box.y + box.h / 2
  return g(
    {},
    words({ p, text: box.el.label, x: box.x, cy }),
    stroke({ d: `M${n(box.x)} ${n(cy + 8)}H${n(box.x + w)}`, color: ink(p).line }),
  )
}

/** Primary actions are filled, ordinary ones outlined, and `!ghost` ones dashed. */
function paintButton(p: Paint): string {
  const { box } = p
  const primary = box.el.flags.has('primary')
  const dash = box.el.flags.has('ghost') ? '4 3' : undefined
  const tone = ink(p)
  return g(
    {},
    outline({ area: box, r: 6, stroke: tone.line, fill: primary ? tone.fill : 'none', dash }),
    words({
      p,
      text: box.el.label || 'Button',
      x: box.x + box.w / 2,
      cy: box.y + box.h / 2,
      anchor: 'middle',
      fill: p.ctx.tokens.fg,
    }),
  )
}

function fieldArea(p: Paint): Area {
  const top = captioned(p.box.el) ? 22 : 0
  return { ...p.box, y: p.box.y + top, h: p.box.h - top }
}

/** The field's name above it when something else fills the field, else inside it. */
function fieldName(p: Paint): string {
  const { box } = p
  if (captioned(box.el)) return words({ p, text: box.el.label, x: box.x, cy: box.y + 8 })
  if (!box.el.label) return ''
  const area = fieldArea(p)
  return words({
    p,
    text: box.el.label,
    x: box.x + 12,
    cy: area.y + Math.min(area.h / 2, 19),
    fill: p.ctx.tokens.faint,
  })
}

/** Dots for a `!secret` field, else a short bar for the placeholder under a named field. */
function fieldValue(p: Paint): string {
  const area = fieldArea(p)
  const cy = area.y + Math.min(area.h / 2, 19)
  if (p.box.el.flags.has('secret'))
    return g(
      {},
      ...Array.from({ length: 6 }, (_, i) =>
        h('circle', { cx: area.x + 16 + i * 11, cy, r: 3, fill: ink(p).strong }),
      ),
    )
  if (!p.box.el.note) return ''
  const w = Math.min(area.w * 0.45, p.ctx.text.width(p.box.el.note, { size: LABEL }))
  return bar({
    x: area.x + 12,
    cy,
    w,
    size: LABEL,
    fill: ink(p).bar,
  })
}

function paintField(p: Paint): string {
  return g(
    {},
    outline({ area: fieldArea(p), r: 4, stroke: ink(p).line }),
    fieldName(p),
    fieldValue(p),
  )
}

function paintSelect(p: Paint): string {
  const area = fieldArea(p)
  const x = area.x + area.w - 22
  const y = area.y + area.h / 2 - 2
  const caret = `M${n(x)} ${n(y)}L${n(x + 5)} ${n(y + 5)}L${n(x + 10)} ${n(y)}`
  return g({}, paintField(p), stroke({ d: caret, color: ink(p).line, width: 1.6 }))
}

function paintSearch(p: Paint): string {
  const { box } = p
  const cy = box.y + box.h / 2
  const glass = `M${n(box.x + 25)} ${n(cy + 5)}L${n(box.x + 29)} ${n(cy + 9)}`
  return g(
    {},
    outline({ area: box, r: box.h / 2, stroke: ink(p).line }),
    h('circle', {
      cx: box.x + 20,
      cy: cy - 1,
      r: 6,
      fill: 'none',
      stroke: ink(p).line,
      'stroke-width': 1.5,
    }),
    stroke({ d: glass, color: ink(p).line, width: 1.5 }),
    box.el.label
      ? words({ p, text: box.el.label, x: box.x + 38, cy, fill: p.ctx.tokens.faint })
      : '',
  )
}

function isOn(el: Element): boolean {
  return el.flags.has('on') || el.flags.has('checked') || el.flags.has('selected')
}

/** The control's mark at the left, its label after it. */
function control({ p, mark, inset }: { p: Paint; mark: string; inset: number }): string {
  const { box } = p
  return g(
    {},
    mark,
    box.el.label ? words({ p, text: box.el.label, x: box.x + inset, cy: box.y + box.h / 2 }) : '',
  )
}

function paintCheck(p: Paint): string {
  const { box } = p
  const y = box.y + box.h / 2 - 8
  const tick = `M${n(box.x + 4)} ${n(y + 8)}L${n(box.x + 7)} ${n(y + 11)}L${n(box.x + 12.5)} ${n(y + 5)}`
  const mark = g(
    {},
    outline({ area: { x: box.x, y, w: 16, h: 16 }, r: 3, stroke: ink(p).line }),
    isOn(box.el) ? stroke({ d: tick, color: p.ctx.tokens.muted, width: 1.8 }) : '',
  )
  return control({ p, mark, inset: 26 })
}

function paintRadio(p: Paint): string {
  const { box } = p
  const cx = box.x + 8
  const cy = box.y + box.h / 2
  const mark = g(
    {},
    h('circle', { cx, cy, r: 7.5, fill: 'none', stroke: ink(p).line, 'stroke-width': 1.3 }),
    isOn(box.el) ? h('circle', { cx, cy, r: 3.5, fill: p.ctx.tokens.muted }) : '',
  )
  return control({ p, mark, inset: 26 })
}

function paintToggle(p: Paint): string {
  const { box } = p
  const y = box.y + box.h / 2 - 9
  const knob = isOn(box.el) ? box.x + 23 : box.x + 9
  const mark = g(
    {},
    outline({ area: { x: box.x, y, w: 32, h: 18 }, r: 9, stroke: ink(p).line }),
    h('circle', {
      cx: knob,
      cy: y + 9,
      r: 5.5,
      fill: isOn(box.el) ? p.ctx.tokens.muted : ink(p).edge,
    }),
  )
  return control({ p, mark, inset: 42 })
}

function cross({ area, color }: { area: Area; color: string }): string {
  const { x, y, w, h: height } = area
  return stroke({
    d: `M${n(x)} ${n(y)}L${n(x + w)} ${n(y + height)}M${n(x + w)} ${n(y)}L${n(x)} ${n(y + height)}`,
    color,
    width: 1,
  })
}

/** A box with a cross through it: the universal "picture goes here". */
function paintImage(p: Paint): string {
  const { box } = p
  const tone = ink(p)
  const play = box.el.flags.has('play')
  const caption = box.el.label
  const capW = caption ? p.ctx.text.width(caption, { size: LABEL, weight: WEIGHT.body }) + 16 : 0
  const cy = play ? box.y + box.h - 18 : box.y + box.h / 2
  const chip = { x: box.x + (box.w - capW) / 2, y: cy - 11, w: capW, h: 22 }
  return g(
    {},
    outline({ area: box, r: 2, stroke: tone.line }),
    cross({ area: box, color: tone.edge }),
    play ? playMark(p) : '',
    caption
      ? h('rect', { ...chip, width: chip.w, height: chip.h, fill: p.ctx.tokens.surface })
      : '',
    caption ? words({ p, text: caption, x: box.x + box.w / 2, cy, anchor: 'middle' }) : '',
  )
}

/** A play button over a video's placeholder. */
function playMark(p: Paint): string {
  const { box } = p
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  const tri = `M${n(cx - 6)} ${n(cy - 9)}L${n(cx + 10)} ${n(cy)}L${n(cx - 6)} ${n(cy + 9)}Z`
  return g(
    {},
    h('circle', {
      cx,
      cy,
      r: 22,
      fill: p.ctx.tokens.surface,
      stroke: ink(p).line,
      'stroke-width': 1.3,
    }),
    h('path', { d: tri, fill: ink(p).strong }),
  )
}

function paintAvatar(p: Paint): string {
  const { box } = p
  const r = box.h / 2
  const name = box.el.label
  const w = name ? p.ctx.text.width(name, { size: LABEL }) : 0
  return g(
    {},
    h('circle', {
      cx: box.x + r,
      cy: box.y + r,
      r,
      fill: 'none',
      stroke: ink(p).line,
      'stroke-width': 1.3,
    }),
    name ? bar({ x: box.x + r * 2 + 12, cy: box.y + r, w, size: LABEL, fill: ink(p).bar }) : '',
  )
}

/** A small circle: an icon goes here. Its name isn't drawn, since the point is the slot. */
function paintIcon(p: Paint): string {
  const { box } = p
  const r = box.h / 2 - 2
  return h('circle', {
    cx: box.x + box.h / 2,
    cy: box.y + box.h / 2,
    r,
    fill: 'none',
    stroke: ink(p).line,
    'stroke-width': 1.3,
  })
}

function paintLogo(p: Paint): string {
  const { box } = p
  const mark = { x: box.x, y: box.y + box.h / 2 - 13, w: 26, h: 26 }
  const w = p.ctx.text.width(box.el.label || 'Logo', { size: 17, weight: WEIGHT.title })
  return g(
    {},
    outline({ area: mark, r: 2, stroke: ink(p).line }),
    cross({ area: mark, color: ink(p).edge }),
    bar({ x: box.x + 36, cy: box.y + box.h / 2, w, size: 17, fill: ink(p).strong }),
  )
}

function paintBadge(p: Paint): string {
  const { box } = p
  return g(
    {},
    outline({ area: box, r: box.h / 2, stroke: ink(p).line }),
    bar({ x: box.x + 10, cy: box.y + box.h / 2, w: box.w - 20, size: 10, fill: ink(p).bar }),
  )
}

function navItem({ p, part, x }: { p: Paint; part: Part; x: number }): { mark: string; w: number } {
  const w = p.ctx.text.width(part.text, { size: 14, weight: WEIGHT.body }) + (part.marked ? 28 : 0)
  const cy = p.box.y + p.box.h / 2
  if (!part.marked) return { mark: words({ p, text: part.text, x, cy }), w }
  const area = { x, y: cy - 16, w, h: 32 }
  const button = outline({ area, r: 6, stroke: ink(p).line, fill: ink(p).fill })
  return {
    mark: g(
      {},
      button,
      words({ p, text: part.text, x: x + w / 2, cy, anchor: 'middle', fill: p.ctx.tokens.fg }),
    ),
    w,
  }
}

function paintNav(p: Paint): string {
  let x = p.box.x
  const marks: string[] = []
  for (const part of p.box.el.parts) {
    const item = navItem({ p, part, x })
    marks.push(item.mark)
    x += item.w + 22
  }
  return g({}, ...marks)
}

function paintTabs(p: Paint): string {
  const { box } = p
  const chosen = Math.max(
    0,
    box.el.parts.findIndex((part) => part.marked),
  )
  const base = box.y + box.h
  const marks = [
    stroke({ d: `M${n(box.x)} ${n(base - 0.5)}H${n(box.x + box.w)}`, color: ink(p).edge }),
  ]
  let x = box.x
  box.el.parts.forEach((part, i) => {
    const w = p.ctx.text.width(part.text, { size: LABEL, weight: WEIGHT.body })
    const on = i === chosen
    marks.push(
      words({
        p,
        text: part.text,
        x,
        cy: box.y + box.h / 2 - 2,
        fill: on ? p.ctx.tokens.fg : undefined,
      }),
    )
    if (on)
      marks.push(
        stroke({ d: `M${n(x)} ${n(base - 1)}H${n(x + w)}`, color: p.ctx.tokens.muted, width: 2.5 }),
      )
    x += w + 28
  })
  return g({}, ...marks)
}

/** Each part of a row as a bar the length of its words, in equal columns. */
function rowBars({ p, parts, area, fill }: { p: Paint; parts: Part[]; area: Area; fill: string }) {
  const colW = area.w / Math.max(1, parts.length)
  return parts.map((part, j) => {
    const w = Math.min(colW - 24, p.ctx.text.width(part.text, { size: LABEL }))
    const x = area.x + j * colW + 12
    return bar({ x, cy: area.y + area.h / 2, w, size: LABEL, fill })
  })
}

function paintList(p: Paint): string {
  const { box } = p
  const tone = ink(p)
  const rowH = box.h / Math.max(1, box.el.rows.length)
  const marks = box.el.rows.map((parts, i) => {
    const area = { ...box, y: box.y + i * rowH, h: rowH }
    const picked = parts.some((part) => part.marked)
    return g(
      {},
      picked ? outline({ area, r: 4, stroke: tone.line, fill: tone.fill }) : '',
      i
        ? stroke({ d: `M${n(box.x)} ${n(area.y)}H${n(box.x + box.w)}`, color: tone.edge, width: 1 })
        : '',
      ...rowBars({ p, parts, area, fill: picked ? tone.strong : tone.bar }),
    )
  })
  return g({}, ...marks)
}

function paintTable(p: Paint): string {
  const { box } = p
  const tone = ink(p)
  const rows = box.el.rows
  const rowH = box.h / Math.max(1, rows.length)
  const cols = Math.max(1, ...rows.map((r) => r.length))
  const rules = rows.slice(1).map((_, i) =>
    stroke({
      d: `M${n(box.x)} ${n(box.y + (i + 1) * rowH)}H${n(box.x + box.w)}`,
      color: tone.edge,
      width: 1,
    }),
  )
  const columns = Array.from({ length: cols - 1 }, (_, j) => {
    const x = box.x + ((j + 1) * box.w) / cols
    return stroke({ d: `M${n(x)} ${n(box.y)}V${n(box.y + box.h)}`, color: tone.edge, width: 1 })
  })
  const cells = rows.flatMap((parts, i) => {
    const area = { ...box, y: box.y + i * rowH, h: rowH }
    return rowBars({ p, parts, area, fill: i === 0 ? tone.strong : tone.bar })
  })
  return g({}, outline({ area: box, r: 2, stroke: tone.line }), ...rules, ...columns, ...cells)
}

/** A chart as a box with the bare shape of its kind: bars, a line or a pie. */
function paintChart(p: Paint): string {
  const { box } = p
  const tone = ink(p)
  const type = box.el.label.split(/\s/)[0].toLowerCase()
  const shapes: Record<string, () => string> = {
    pie: () => chartPie(p),
    donut: () => chartPie(p),
    line: () => chartLine(p),
    area: () => chartLine(p),
  }
  return g(
    {},
    outline({ area: box, r: 2, stroke: tone.line }),
    (shapes[type] ?? (() => chartBars(p)))(),
  )
}

function chartBars(p: Paint): string {
  const { box } = p
  const heights = [0.45, 0.7, 0.55, 0.85, 0.6, 0.75, 0.5]
  const step = (box.w - 32) / heights.length
  return g(
    {},
    ...heights.map((k, i) => {
      const height = (box.h - 32) * k
      return h('rect', {
        x: box.x + 16 + i * step + step * 0.2,
        y: box.y + box.h - 16 - height,
        width: step * 0.6,
        height,
        fill: ink(p).bar,
      })
    }),
  )
}

function chartLine(p: Paint): string {
  const { box } = p
  const ys = [0.7, 0.55, 0.62, 0.4, 0.48, 0.3, 0.35, 0.2]
  const points = ys.map(
    (k, i) =>
      `${n(box.x + 16 + (i / (ys.length - 1)) * (box.w - 32))} ${n(box.y + 16 + (box.h - 32) * k)}`,
  )
  return stroke({ d: `M${points.join('L')}`, color: ink(p).strong, width: 2 })
}

function chartPie(p: Paint): string {
  const { box } = p
  const r = Math.min(box.w, box.h) / 2 - 16
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  const slice = `M${n(cx)} ${n(cy)}V${n(cy - r)}M${n(cx)} ${n(cy)}L${n(cx + r * Math.sin(2.2))} ${n(cy - r * Math.cos(2.2))}`
  return g(
    {},
    h('circle', { cx, cy, r, fill: 'none', stroke: ink(p).strong, 'stroke-width': 1.5 }),
    stroke({ d: slice, color: ink(p).strong, width: 1.5 }),
  )
}

function paintDivider(p: Paint): string {
  const { box } = p
  return stroke({
    d: `M${n(box.x)} ${n(box.y + 0.5)}H${n(box.x + box.w)}`,
    color: ink(p).edge,
    width: 1,
  })
}

/**
 * Containers that carry meaning are outlined, so the nesting reads at a glance. Rows, columns and
 * grids only arrange things and stay invisible; `!box` outlines them too.
 */
function containerEdge(p: Paint): string {
  const { box } = p
  const tone = ink(p)
  const { el } = box
  const edges: Partial<Record<Kind, () => string>> = {
    card: () => outline({ area: box, r: 6, stroke: tone.line }),
    section: () => outline({ area: box, r: 6, stroke: tone.line, dash: '5 4' }),
    modal: () =>
      outline({ area: box, r: 6, stroke: p.ctx.tokens.muted, fill: p.ctx.tokens.surface }),
    sidebar: () => outline({ area: box, r: 0, stroke: tone.line }),
    header: () => outline({ area: box, r: 0, stroke: tone.line }),
    footer: () => outline({ area: box, r: 0, stroke: tone.line }),
  }
  const edge = edges[el.kind]
  if (edge) return edge()
  if (el.flags.has('box')) return outline({ area: box, r: 4, stroke: tone.line, dash: '3 3' })
  return ''
}

function paintContainer(p: Paint): string {
  return g({}, containerEdge(p), ...p.box.kids.map((box) => paint({ ...p, box })))
}

const PAINTERS: Partial<Record<Kind, Painter>> = {
  h1: paintText,
  h2: paintText,
  h3: paintText,
  text: paintText,
  lines: paintLines,
  link: paintLink,
  button: paintButton,
  input: paintField,
  textarea: paintField,
  select: paintSelect,
  search: paintSearch,
  check: paintCheck,
  radio: paintRadio,
  toggle: paintToggle,
  image: paintImage,
  avatar: paintAvatar,
  icon: paintIcon,
  logo: paintLogo,
  badge: paintBadge,
  nav: paintNav,
  tabs: paintTabs,
  list: paintList,
  table: paintTable,
  chart: paintChart,
  divider: paintDivider,
}

/** Every element and its id for the host app: its `id=`, or its label or kind as a slug. */
export function elementIds(elements: Element[]): Map<Element, string> {
  const next = uniqueIds()
  const ids = new Map<Element, string>()
  const walk = (el: Element) => {
    ids.set(el, next(el.attrs.id ?? slug(el.label || el.kind)))
    el.children.forEach(walk)
  }
  elements.forEach(walk)
  return ids
}

export function paint(p: Paint): string {
  const { el } = p.box
  const painter = PAINTERS[el.kind] ?? (el.kind === 'spacer' ? null : paintContainer)
  const body = painter?.(p)
  const tint = ink(p).word
  return body ? g(target({ id: p.ids.get(el) ?? '', kind: el.kind, tint }), body) : ''
}
