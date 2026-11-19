/**
 * SVG geometry for a DOM with no layout engine (jsdom): the boxes `getBBox` would return, worked
 * out from each element's attributes, with text measured from our font tables. Mermaid sizes every
 * node from these, so they decide the layout.
 */
import type { TextKit } from '../core/text.ts'

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

const EMPTY: Box = { x: 0, y: 0, width: 0, height: 0 }

type Matrix = [number, number, number, number, number, number]

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

function num(el: Element, name: string): number {
  return Number.parseFloat(el.getAttribute(name) ?? '') || 0
}

function boxOfPoints(points: number[][]): Box {
  if (!points.length) return EMPTY
  const xs = points.map((p) => p[0])
  const ys = points.map((p) => p[1])
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}

function union(boxes: Box[]): Box {
  const real = boxes.filter((b) => b.width > 0 || b.height > 0)
  return boxOfPoints(
    real.flatMap((b) => [
      [b.x, b.y],
      [b.x + b.width, b.y + b.height],
    ]),
  )
}

/** The matrices applied left to right, as SVG lists them in a `transform`. */
function compose(matrices: Matrix[]): Matrix {
  return matrices.reduce((a, b) => [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ], IDENTITY)
}

function rotation(args: number[]): Matrix {
  const [deg, cx = 0, cy = 0] = args
  const r = (deg * Math.PI) / 180
  const turn: Matrix = [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]
  return compose([[1, 0, 0, 1, cx, cy], turn, [1, 0, 0, 1, -cx, -cy]])
}

function step({ name, args }: { name: string; args: number[] }): Matrix {
  if (name === 'translate') return [1, 0, 0, 1, args[0] ?? 0, args[1] ?? 0]
  if (name === 'scale') return [args[0] ?? 1, 0, 0, args[1] ?? args[0] ?? 1, 0, 0]
  if (name === 'rotate') return rotation(args)
  if (name === 'matrix' && args.length === 6)
    return [args[0], args[1], args[2], args[3], args[4], args[5]]
  return IDENTITY
}

/** An element's `transform` attribute as one matrix. */
export function transformOf(el: Element): Matrix {
  const text = el.getAttribute('transform') ?? ''
  const steps = Array.from(text.matchAll(/(\w+)\s*\(([^)]*)\)/g), ([, name, raw]) =>
    step({ name, args: raw.split(/[\s,]+/).filter(Boolean).map(Number) }),
  )
  return steps.length ? compose(steps) : IDENTITY
}

function apply({ box, matrix }: { box: Box; matrix: Matrix }): Box {
  if (matrix === IDENTITY || (box.width === 0 && box.height === 0)) return box
  const corners = [
    [box.x, box.y],
    [box.x + box.width, box.y],
    [box.x, box.y + box.height],
    [box.x + box.width, box.y + box.height],
  ]
  return boxOfPoints(
    corners.map(([x, y]) => [
      matrix[0] * x + matrix[2] * y + matrix[4],
      matrix[1] * x + matrix[3] * y + matrix[5],
    ]),
  )
}

const ARGS: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7 }

interface Pen {
  x: number
  y: number
  startX: number
  startY: number
}

/** A box an arc stays inside: its radii out from its chord's middle. Ignores the ellipse's rotation. */
function arcReach({ from, to, rx, ry }: { from: number[]; to: number[]; rx: number; ry: number }): number[][] {
  const mx = (from[0] + to[0]) / 2
  const my = (from[1] + to[1]) / 2
  return [
    [mx - Math.abs(rx), my - Math.abs(ry)],
    [mx + Math.abs(rx), my + Math.abs(ry)],
  ]
}

/** Moves the pen through one path segment and returns the points it passes or pulls toward. */
function segment({ pen, letter, args }: { pen: Pen; letter: string; args: number[] }): number[][] {
  const lower = letter.toLowerCase()
  const ox = letter === lower ? pen.x : 0
  const oy = letter === lower ? pen.y : 0
  if (lower === 'h') pen.x = ox + args[0]
  if (lower === 'v') pen.y = oy + args[0]
  if (lower === 'h' || lower === 'v') return [[pen.x, pen.y]]
  if (lower === 'a') {
    const from = [pen.x, pen.y]
    pen.x = ox + args[5]
    pen.y = oy + args[6]
    return [from, ...arcReach({ from, to: [pen.x, pen.y], rx: args[0], ry: args[1] }), [pen.x, pen.y]]
  }
  const points: number[][] = []
  for (let j = 0; j < args.length; j += 2) points.push([ox + args[j], oy + args[j + 1]])
  pen.x = ox + args[args.length - 2]
  pen.y = oy + args[args.length - 1]
  return points
}

/** Every point a path passes through or pulls toward: a box that holds its curves. */
export function pathPoints(d: string): number[][] {
  const points: number[][] = []
  const pen: Pen = { x: 0, y: 0, startX: 0, startY: 0 }
  for (const [, letter, raw] of d.matchAll(/([a-zA-Z])([^a-zA-Z]*)/g)) {
    const size = ARGS[letter.toLowerCase()] ?? 0
    if (!size) {
      pen.x = pen.startX
      pen.y = pen.startY
      continue
    }
    const values = (raw.match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? []).map(Number)
    for (let i = 0; i + size <= values.length; i += size) {
      points.push(...segment({ pen, letter, args: values.slice(i, i + size) }))
      if (i === 0 && 'mM'.includes(letter)) Object.assign(pen, { startX: pen.x, startY: pen.y })
    }
  }
  return points
}

function sizeIn(el: Element): number {
  const style = el.getAttribute('style') ?? ''
  const raw = /font-size:\s*([\d.]+)/.exec(style)?.[1] ?? el.getAttribute('font-size') ?? ''
  return Number.parseFloat(raw) || 0
}

function weightOf(raw: string): number {
  if (raw === 'bold' || raw === 'bolder') return 700
  if (raw === 'normal') return 400
  return Number.parseFloat(raw) || 0
}

function weightIn(el: Element): number {
  const style = el.getAttribute('style') ?? ''
  return weightOf(/font-weight:\s*(\w+)/.exec(style)?.[1] ?? el.getAttribute('font-weight') ?? '')
}

/** The style a stylesheet gives an element, when its document can work it out. */
function computed(el: Element): CSSStyleDeclaration | null {
  return el.ownerDocument.defaultView?.getComputedStyle(el) ?? null
}

/**
 * The font size and weight an element's text is drawn at: from its own or an ancestor's attributes
 * and inline style, which Mermaid sets per label, then from the stylesheet.
 */
export function fontOf({ el, fallback }: { el: Element; fallback: number }): {
  size: number
  weight: number
} {
  let size = 0
  let weight = 0
  for (let at: Element | null = el; at && !(size && weight); at = at.parentElement) {
    size ||= sizeIn(at)
    weight ||= weightIn(at)
  }
  const sheet = size && weight ? null : computed(el)
  size ||= Number.parseFloat(sheet?.fontSize ?? '') || fallback
  weight ||= weightOf(sheet?.fontWeight ?? '') || 400
  return { size, weight }
}

function breaksLine(el: Element | null): boolean {
  return !!el && (el.hasAttribute('dy') || el.hasAttribute('y'))
}

/** The lines a <text> draws: each <tspan> that starts a new line, or the text itself. */
function textLines(el: Element): Element[] {
  const spans = Array.from(el.children).filter((c) => c.localName === 'tspan')
  const breaks = spans.filter((s, i) => i === 0 || breaksLine(s))
  return breaks.length ? breaks : [el]
}

/** Text as SVG draws it by default: runs of whitespace as one space, none at the ends. */
function collapsed(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function lineText(line: Element): string {
  if (line.localName !== 'tspan') return collapsed(line.textContent ?? '')
  let text = line.textContent ?? ''
  for (let next = line.nextElementSibling; next && !breaksLine(next); next = next.nextElementSibling)
    text += next.textContent ?? ''
  return collapsed(text)
}

const ANCHOR_SHARE: Record<string, number> = { start: 0, middle: 0.5, end: 1 }

function anchorShare(el: Element): number {
  for (let at: Element | null = el; at; at = at.parentElement) {
    const style = /text-anchor:\s*(\w+)/.exec(at.getAttribute('style') ?? '')?.[1]
    const anchor = style ?? at.getAttribute('text-anchor')
    if (anchor) return ANCHOR_SHARE[anchor] ?? 0
  }
  return ANCHOR_SHARE[computed(el)?.textAnchor ?? ''] ?? 0
}

/** The width of an element's text on one line. */
export function textLength({
  el,
  kit,
  fallback,
}: {
  el: Element
  kit: TextKit
  fallback: number
}): number {
  return kit.width(collapsed(el.textContent ?? ''), fontOf({ el, fallback }))
}

/** A length attribute in px, with `em` taken at the text's size. */
function length({ el, name, size }: { el: Element; name: string; size: number }): number {
  const raw = el.getAttribute(name) ?? ''
  const value = Number.parseFloat(raw) || 0
  return raw.trim().endsWith('em') ? value * size : value
}

/** Where a line's baseline sits: its own `y` (or its text's) moved by its own `dy` (or its text's). */
function baselineOf({ line, text, size }: { line: Element; text: Element; size: number }): number {
  const own = line.hasAttribute('y') ? line : text
  const shift = line.hasAttribute('dy') ? line : text
  return length({ el: own, name: 'y', size }) + length({ el: shift, name: 'dy', size })
}

function textBox({ el, kit, fallback }: { el: Element; kit: TextKit; fallback: number }): Box {
  const text = el.closest('text') ?? el
  const style = fontOf({ el, fallback })
  const lines = el.localName === 'tspan' ? [el] : textLines(el)
  const width = Math.max(0, ...lines.map((line) => kit.width(lineText(line), style)))
  if (width === 0) return EMPTY
  const x = length({ el, name: 'x', size: style.size }) || length({ el: text, name: 'x', size: style.size })
  const baselines = lines.map((line) => baselineOf({ line, text, size: style.size }))
  const top = Math.min(...baselines) - style.size * kit.metrics.ascent
  const bottom = Math.max(...baselines) - style.size * kit.metrics.descent
  return { x: x - width * anchorShare(text), y: top, width, height: bottom - top }
}

function pointsBox(el: Element): Box {
  const values = (el.getAttribute('points') ?? '').split(/[\s,]+/).filter(Boolean).map(Number)
  return boxOfPoints(values.flatMap((v, i) => (i % 2 ? [] : [[v, values[i + 1] ?? 0]])))
}

function ellipseBox({ el, rx, ry }: { el: Element; rx: number; ry: number }): Box {
  return { x: num(el, 'cx') - rx, y: num(el, 'cy') - ry, width: 2 * rx, height: 2 * ry }
}

function rectBox(el: Element): Box {
  return { x: num(el, 'x'), y: num(el, 'y'), width: num(el, 'width'), height: num(el, 'height') }
}

const SHAPES: Record<string, (el: Element) => Box> = {
  rect: rectBox,
  image: rectBox,
  foreignObject: rectBox,
  use: rectBox,
  circle: (el) => ellipseBox({ el, rx: num(el, 'r'), ry: num(el, 'r') }),
  ellipse: (el) => ellipseBox({ el, rx: num(el, 'rx'), ry: num(el, 'ry') }),
  line: (el) =>
    boxOfPoints([
      [num(el, 'x1'), num(el, 'y1')],
      [num(el, 'x2'), num(el, 'y2')],
    ]),
  polygon: pointsBox,
  polyline: pointsBox,
  path: (el) => boxOfPoints(pathPoints(el.getAttribute('d') ?? '')),
}

const SKIP = new Set([
  'defs',
  'style',
  'title',
  'desc',
  'marker',
  'clipPath',
  'mask',
  'linearGradient',
  'radialGradient',
  'pattern',
  'symbol',
  'script',
])

function hidden(el: Element): boolean {
  if (SKIP.has(el.localName) || el.getAttribute('display') === 'none') return true
  return /display:\s*none/.test(el.getAttribute('style') ?? '')
}

/** What `getBBox()` returns for an element: its own geometry, before its own transform. */
export function bboxOf({ el, kit, fallback }: { el: Element; kit: TextKit; fallback: number }): Box {
  if (el.localName === 'text' || el.localName === 'tspan') return textBox({ el, kit, fallback })
  const shape = SHAPES[el.localName]
  if (shape) return shape(el)
  const children = Array.from(el.children).filter((c) => !hidden(c))
  return union(
    children.map((c) => apply({ box: bboxOf({ el: c, kit, fallback }), matrix: transformOf(c) })),
  )
}

/** An element's box in its root svg's user space, through every ancestor's transform. */
export function screenBoxOf({
  el,
  kit,
  fallback,
}: {
  el: Element
  kit: TextKit
  fallback: number
}): Box {
  let box = apply({ box: bboxOf({ el, kit, fallback }), matrix: transformOf(el) })
  for (let at = el.parentElement; at && at.localName !== 'svg'; at = at.parentElement)
    box = apply({ box, matrix: transformOf(at) })
  return box
}
