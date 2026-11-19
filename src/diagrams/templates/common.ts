import { roundedRect } from '../../core/geometry.ts'
import { type Diagnostic, type Line, labeled, splitNote, unquote } from '../../core/parse.ts'
import type { Rng } from '../../core/rng.ts'
import { g, h, text } from '../../core/svg.ts'
import { balance, type TextKit } from '../../core/text.ts'
import type { Context, Drawing } from '../../core/types.ts'
import { mix } from '../../theme/color.ts'
import {
  corner,
  NAMED_HUES,
  OUTLINE,
  pick,
  type Swatch,
  swatchFor,
  type Tokens,
  toned,
  WEIGHT,
} from '../../theme/index.ts'

/**
 * Shared pieces for the template scenes: header and item parsing, text placement, chips, and
 * framing a scene under its title.
 */

export const MARGIN = 32
export const LABEL = 15
export const NOTE = 13
export const TITLE = 20

export interface Head {
  keyword: string
  title: string
  /** Words after the title that aren't attributes, such as the poles of a spectrum. */
  rest: string
  attrs: Record<string, string>
  flags: Set<string>
  line: number
}

/**
 * Reads `keyword "Title" key=value !flag`. The title may be quoted, which lets more words follow
 * it; unquoted, everything before the attributes is the title.
 */
export function readHead(first: Line | undefined): Head {
  const raw = first?.text ?? ''
  const keyword = raw.split(/\s/)[0].toLowerCase()
  const after = raw.slice(keyword.length).trim()
  const quoted = /^"([^"]*)"\s*(.*)$/.exec(after)
  const parsed = labeled(quoted ? quoted[2] : after)
  return {
    keyword,
    title: quoted ? quoted[1] : parsed.label,
    rest: quoted ? parsed.label : '',
    attrs: parsed.attrs,
    flags: parsed.flags,
    line: first?.no ?? 1,
  }
}

export interface Item {
  label: string
  note?: string
  color?: string
  /** `@ 0.3` or `@ 0.2,0.8`: a position from 0 to 1 along each axis. */
  at?: number[]
  attrs: Record<string, string>
  flags: Set<string>
  line: number
}

/** A position at the very end of a line: `@ 0.3` or `@ 0.3,0.7`. */
const AT = /(?:^|\s+)@\s*(-?\d*\.?\d+)\s*(?:,\s*(-?\d*\.?\d+))?$/

/** Takes a trailing position off `text`, if it has one. */
function takePosition(text: string): { rest: string; at?: number[] } {
  const found = AT.exec(text)
  if (!found) return { rest: text }
  const at = [Number(found[1]), ...(found[2] === undefined ? [] : [Number(found[2])])]
  return { rest: text.slice(0, found.index), at: at.map(clamp01) }
}

/**
 * One item line: `Label : note @ 0.3 #color`. A colon followed by a space starts the note, unless
 * it's inside quotes. Only types that place items (`positions`) read the trailing `@ 0.3`; for the
 * rest, `@` is just text.
 */
export function readItem(line: Line, { positions = false }: { positions?: boolean } = {}): Item {
  const parsed = labeled(line.text)
  const placed = positions ? takePosition(parsed.raw) : { rest: parsed.raw }
  const split = splitNote(placed.rest)
  const label = split ? split[0] : placed.rest
  const note = split?.[1] ?? ''
  return {
    label: unquote(label.trim()),
    note: note ? unquote(note) : undefined,
    color: parsed.color,
    at: placed.at,
    attrs: parsed.attrs,
    flags: parsed.flags,
    line: line.no,
  }
}

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

/** The author's color when given, else the categorical swatch at `index`. */
export function tone({
  tokens,
  color,
  index,
}: {
  tokens: Tokens
  color?: string
  index: number
}): Swatch {
  return (color && swatchFor({ tokens, color })) || pick({ tokens, index })
}

/** The two neighboring hues an ordered series runs between, first item to last. */
export type Hues = [number, number]

const RAMP: Hues = [195, 250]

/**
 * Reads `colors=teal-blue` (or `teal..blue`, or one name for a single hue) from a header: the
 * hues an ordered series runs between. Unknown names leave the default and say which names work.
 */
export function readHues(head: Head): { hues?: Hues; diagnostic?: Diagnostic } {
  const raw = head.attrs.colors
  if (!raw) return {}
  const names = raw.toLowerCase().split(/-|\.\.+/)
  const found = names.map((name) => NAMED_HUES[name])
  if (names.length <= 2 && found.every((hue) => hue !== undefined))
    return { hues: [found[0], found[found.length - 1]] }
  return {
    diagnostic: {
      line: head.line,
      message: `colors=${raw}: use one or two color names, like colors=teal-blue. Names: ${Object.keys(NAMED_HUES).join(', ')}.`,
      severity: 'warning',
    },
  }
}

/** The hue `t` of the way from `a` to `b`, the short way round the wheel. */
export function between({ hues: [a, b], t }: { hues: Hues; t: number }): number {
  const span = ((b - a + 540) % 360) - 180
  return (a + span * t + 360) % 360
}

/**
 * A step along an ordered series (tiers, stages, layers): the hue slides between two neighbors
 * while the tint deepens from barely there to soft, so order reads as depth rather than as a
 * rainbow of unrelated categories. An author's color holds its own hue.
 */
export function ramp({
  tokens,
  color,
  index,
  count,
  hues = RAMP,
}: {
  tokens: Tokens
  color?: string
  index: number
  count: number
  hues?: Hues
}): Swatch {
  const t = count > 1 ? index / (count - 1) : 0.5
  const authored = color && swatchFor({ tokens, color })
  const base = authored || toned({ tokens, hue: between({ hues, t }) })
  return { ...base, fill: mix({ from: tokens.surface, to: base.soft, amount: 0.15 + 0.85 * t }) }
}

/** A neutral fill a step off the card toward its border, so notes and chips sit on it, not in it. */
export function raised(tokens: Tokens): string {
  return mix({ from: tokens.surface, to: tokens.border, amount: 0.35 })
}

/** A neutral chip style: raised fill, border outline, ink text. */
export function plainChip(tokens: Tokens): Swatch {
  return { ...tokens.semantic.neutral, soft: raised(tokens), stroke: tokens.border }
}

/** A large area's tint: half way from the card to the swatch's fill, so big shapes stay paper. */
export function wash({ tokens, swatch }: { tokens: Tokens; swatch: Swatch }): string {
  return mix({ from: tokens.surface, to: swatch.fill, amount: 0.5 })
}

export interface Say {
  x: number
  y: number
  lines: string[]
  size: number
  weight?: number
  fill: string
  anchor?: 'start' | 'middle' | 'end'
  valign?: 'middle' | 'top'
}

/** A text placer bound to a kit, so callers don't repeat the line-height arithmetic. */
export function sayer(kit: TextKit): (options: Say) => string {
  return function say(options: Say): string {
    return text({
      ...options,
      lineHeight: kit.lineHeight({ size: options.size }),
      shift: kit.baselineShift({ size: options.size }),
    })
  }
}

/** Height of a block of `count` lines at `size`. */
export function blockHeight({ kit, count, size }: { kit: TextKit; count: number; size: number }) {
  return count ? (count - 1) * kit.lineHeight({ size }) + size * 1.1 : 0
}

/** Seeded hand-made variation for the sketch look; zero otherwise. */
export function jitter({ ctx, amount }: { ctx: Context; amount: number }): () => number {
  const random: Rng = ctx.rng
  if (ctx.tokens.look !== 'sketch') return () => 0
  return () => random.normal() * amount
}

export interface ChipSize {
  lines: string[]
  font: number
  w: number
  h: number
}

/** The size of a pill holding a label, wrapped when it's longer than `max`. */
export function chipSize({
  kit,
  label,
  size,
  max,
}: {
  kit: TextKit
  label: string
  size: number
  max: number
}): ChipSize {
  const style = { size, weight: WEIGHT.body }
  const lines = balance({ kit, text: label, style, max: max - 24 })
  const w = Math.max(...lines.map((l) => kit.width(l, style))) + 24
  return {
    lines,
    font: size,
    w: Math.min(Math.max(w, 36), max),
    h: blockHeight({ kit, count: lines.length, size }) + 14,
  }
}

/**
 * A chip with its label centered, toned from its swatch so it reads as raised from the card it
 * sits on rather than a hole through to the canvas: `outline` keeps a faint colored edge,
 * `filled` a solid one.
 */
export function drawChip({
  ctx,
  x,
  y,
  size,
  swatch,
  variant = 'outline',
}: {
  ctx: Context
  x: number
  y: number
  size: ChipSize
  swatch: Swatch
  variant?: 'outline' | 'filled'
}): string {
  const say = sayer(ctx.text)
  const radius = corner({ tokens: ctx.tokens, r: size.lines.length > 1 ? 10 : size.h / 2 })
  const filled = variant === 'filled'
  return g(
    {},
    h('path', {
      d: roundedRect({ x, y, w: size.w, h: size.h, r: radius }),
      fill: swatch.soft,
      stroke: swatch.stroke,
      'stroke-width': filled ? 1 : OUTLINE.thin,
      'stroke-opacity': filled ? 1 : 0.55,
    }),
    say({
      x: x + size.w / 2,
      y: y + size.h / 2,
      lines: size.lines,
      size: size.font,
      weight: WEIGHT.body,
      fill: filled ? swatch.ink : ctx.tokens.fg,
    }),
  )
}

export interface Placed {
  x: number
  y: number
}

/** Packs boxes left to right into rows no wider than `max`; returns positions and total size. */
export function flow({
  sizes,
  max,
  gap,
  center = false,
}: {
  sizes: { w: number; h: number }[]
  max: number
  gap: number
  center?: boolean
}): { at: Placed[]; w: number; h: number } {
  const rows: { items: number[]; w: number; h: number }[] = []
  sizes.forEach((s, i) => {
    const row = rows[rows.length - 1]
    if (row && row.w + gap + s.w <= max) {
      row.items.push(i)
      row.w += gap + s.w
      row.h = Math.max(row.h, s.h)
    } else rows.push({ items: [i], w: s.w, h: s.h })
  })
  const at: Placed[] = []
  let y = 0
  for (const row of rows) {
    let x = center ? (max - row.w) / 2 : 0
    for (const i of row.items) {
      at[i] = { x, y: y + (row.h - sizes[i].h) / 2 }
      x += sizes[i].w + gap
    }
    y += row.h + gap
  }
  return { at, w: Math.max(0, ...rows.map((r) => r.w)), h: Math.max(0, y - gap) }
}

/** Running extents of a scene drawn in its own coordinates. */
export class Bounds {
  x0 = Infinity
  y0 = Infinity
  x1 = -Infinity
  y1 = -Infinity

  add({ x, y, w = 0, h: height = 0 }: { x: number; y: number; w?: number; h?: number }): void {
    this.x0 = Math.min(this.x0, x)
    this.y0 = Math.min(this.y0, y)
    this.x1 = Math.max(this.x1, x + w)
    this.y1 = Math.max(this.y1, y + height)
  }

  /** A text block anchored at (x, y), its vertical center. */
  addText({
    kit,
    x,
    y,
    lines,
    size,
    weight,
    anchor = 'middle',
  }: {
    kit: TextKit
    x: number
    y: number
    lines: string[]
    size: number
    weight?: number
    anchor?: 'start' | 'middle' | 'end'
  }): void {
    const w = Math.max(0, ...lines.map((l) => kit.width(l, { size, weight })))
    const height = blockHeight({ kit, count: lines.length, size })
    const offsets = { start: 0, middle: w / 2, end: w }
    this.add({ x: x - offsets[anchor], y: y - height / 2, w, h: height })
  }
}

/**
 * Wraps a scene under its title. The scene's extents are shifted to sit inside the margin, and the
 * narrower of title and scene is centered on the other.
 */
export function frame({
  ctx,
  title,
  body,
  bounds,
  defs,
}: {
  ctx: Context
  title: string
  body: string
  bounds: Bounds
  defs?: string
}): Drawing {
  const say = sayer(ctx.text)
  const sceneW = bounds.x1 - bounds.x0
  const sceneH = bounds.y1 - bounds.y0
  const titleW = title ? ctx.text.width(title, { size: TITLE, weight: WEIGHT.title }) : 0
  const inner = Math.max(sceneW, titleW)
  const top = title ? 70 : MARGIN
  const width = inner + MARGIN * 2
  const dx = MARGIN + (inner - sceneW) / 2 - bounds.x0
  const dy = top - bounds.y0
  return {
    width,
    height: top + sceneH + MARGIN,
    body: g(
      {},
      title
        ? say({
            x: width / 2,
            y: 38,
            lines: [title],
            size: TITLE,
            weight: WEIGHT.title,
            fill: ctx.tokens.fg,
          })
        : '',
      g({ x: dx, y: dy }, body),
    ),
    defs,
    title: title || undefined,
  }
}

/** Splits `A .. B` (or `A --> B`, `A -> B`, `A ↔ B`) into two poles. */
export function poles(text: string): [string, string] | null {
  const found = /^(.*?)\s*(?:\.\.+|<?-+>|→|↔)\s*(.*)$/.exec(text.trim())
  if (!found || !found[1] || !found[2]) return null
  return [unquote(found[1].trim()), unquote(found[2].trim())]
}

/** A short id for gradients and markers, stable for the same source. */
export function uid({ ctx, prefix }: { ctx: Context; prefix: string }): string {
  return `${prefix}-${Math.floor(ctx.rng.fork(prefix).next() * 1e8).toString(36)}`
}
