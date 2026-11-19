/**
 * Icons in labels: `:name:` anywhere in a label draws that Lucide icon (ISC license) inline, at text
 * size and in the text's color. Lucide draws on a 24-unit grid in strokes of `currentColor`.
 *
 * The text kit measures a line with its icons counted, `text()` leaves a placeholder where each icon
 * goes, and `placeIcons` swaps the placeholders for drawn icons once the drawing is done.
 */
import { icons as lucide } from '@iconify-json/lucide'
import type { Diagnostic } from './parse.ts'
import type { TextKit } from './text.ts'

/** An icon's box, in em of the text it sits in. */
export const ICON_EM = 1.15
/** The space between an icon and the text after it, in em. */
const GAP_EM = 0.3

/** `:name:`, with the one space after it that the icon's gap replaces. */
const TOKEN = /:([a-z][a-z0-9-]*):( ?)/g

/** The icon's SVG markup on its 24-unit grid, or null when Lucide has no icon by that name. */
export function iconBody(name: string): string | null {
  const parent = lucide.aliases?.[name]?.parent ?? name
  return lucide.icons[parent]?.body ?? null
}

export type IconPart = { text: string } | { icon: string }

/** A line split into text and the icons in it; unknown names stay as text. */
export function splitIcons(line: string): IconPart[] {
  const parts: IconPart[] = []
  let last = 0
  for (const match of line.matchAll(TOKEN)) {
    if (!iconBody(match[1])) continue
    if (match.index > last) parts.push({ text: line.slice(last, match.index) })
    parts.push({ icon: match[1] })
    last = match.index + match[0].length
  }
  if (last < line.length) parts.push({ text: line.slice(last) })
  return parts
}

/** Whether a line may hold an icon: a cheap test before splitting. */
export function mayHaveIcon(line: string): boolean {
  return line.includes(':') && /:[a-z][a-z0-9-]*:/.test(line)
}

/** How far an icon advances the line: its box, and the gap when text follows. */
export function iconAdvance({ size, last }: { size: number; last: boolean }): number {
  return size * (ICON_EM + (last ? 0 : GAP_EM))
}

/** A line's width with its icons counted, measuring its text with `measure`. */
export function widthWithIcons({
  line,
  size,
  measure,
}: {
  line: string
  size: number
  measure: (text: string) => number
}): number {
  const parts = splitIcons(line)
  return parts.reduce(
    (sum, part, i) =>
      sum + ('icon' in part ? iconAdvance({ size, last: i === parts.length - 1 }) : measure(part.text)),
    0,
  )
}

/** The placeholder `text()` leaves where an icon goes. */
export function iconPlaceholder(name: string): string {
  return `<tspan class="mm-icon" data-icon="${name}"/>`
}

const PLACEHOLDER = /<tspan class="mm-icon" data-icon="([a-z0-9-]+)"\/>/g

const round = (value: number) => String(Math.round(value * 100) / 100)

/** An icon drawn with its box's top-left at (x, y), `size` px wide, in `color`. */
export function iconSvg({
  name,
  x,
  y,
  size,
  color,
}: {
  name: string
  x: number
  y: number
  size: number
  color: string
}): string {
  const place = `translate(${round(x)} ${round(y)}) scale(${round(size / 24)})`
  return `<g class="mm-icon" color="${color}" transform="${place}">${iconBody(name) ?? ''}</g>`
}

function attr({ tag, name }: { tag: string; name: string }): string | null {
  return new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? null
}

function plain(markup: string): string {
  return markup
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
}

const ANCHOR_SHARE: Record<string, number> = { start: 0, middle: 0.5, end: 1 }

interface Style {
  size: number
  weight: number
  color: string
  share: number
  kit: TextKit
}

interface Line {
  x: number
  y: number
  content: string
}

/**
 * One line set from its left edge: text pieces with gaps (dx) where icons go, and the icons drawn
 * into those gaps. Anchoring from the left keeps an icon at the end of a line in the measure.
 */
function layLine({ line, style }: { line: Line; style: Style }): { tspan: string; icons: string } {
  const pieces = line.content.split(PLACEHOLDER)
  const font = { size: style.size, weight: style.weight }
  const advance = (i: number) =>
    i % 2
      ? iconAdvance({ size: style.size, last: i === pieces.length - 2 && !pieces[i + 1] })
      : style.kit.width(plain(pieces[i]), font)
  const advances = pieces.map((_, i) => advance(i))
  const left = line.x - advances.reduce((sum, a) => sum + a, 0) * style.share
  const box = style.size * ICON_EM
  const top = line.y - (style.size * style.kit.metrics.capHeight) / 2 - box / 2
  let at = left + advances[0]
  let gap = 0
  let content = pieces[0]
  let icons = ''
  for (let i = 1; i < pieces.length; i += 2) {
    icons += iconSvg({ name: pieces[i], x: at, y: top, size: box, color: style.color })
    gap += advances[i]
    at += advances[i] + advances[i + 1]
    if (!pieces[i + 1]) continue
    content += `<tspan dx="${round(gap)}">${pieces[i + 1]}</tspan>`
    gap = 0
  }
  return { tspan: `<tspan x="${round(left)}" y="${round(line.y)}">${content}</tspan>`, icons }
}

const LINE = /<tspan x="([^"]+)" y="([^"]+)">([\s\S]*?)<\/tspan>(?=<tspan x="|$)/g

/** A `<text>` from `text()` with its icons laid out: the text, start-anchored, then the icons. */
function layText({ open, body, kit }: { open: string; body: string; kit: TextKit }): string {
  const style: Style = {
    size: Number(attr({ tag: open, name: 'font-size' })) || 14,
    weight: Number(attr({ tag: open, name: 'font-weight' })) || 400,
    color: attr({ tag: open, name: 'fill' }) ?? 'currentColor',
    share: ANCHOR_SHARE[attr({ tag: open, name: 'text-anchor' }) ?? 'start'] ?? 0,
    kit,
  }
  let content = ''
  let icons = ''
  let last = 0
  for (const match of body.matchAll(LINE)) {
    const line = { x: Number(match[1]), y: Number(match[2]), content: match[3] }
    const laid = layLine({ line, style })
    content += body.slice(last, match.index) + laid.tspan
    icons += laid.icons
    last = match.index + match[0].length
  }
  content += body.slice(last)
  const start = open.replace(/\stext-anchor="[^"]*"/, '').replace(/\/?>$/, ' text-anchor="start">')
  const transform = attr({ tag: open, name: 'transform' })
  return `${start}${content}</text>${transform ? `<g transform="${transform}">${icons}</g>` : icons}`
}

const TEXT = /(<text\b[^>]*>)([\s\S]*?)<\/text>/g

/** Replaces every icon placeholder in a drawing's markup with the icon, measured with `kit`. */
export function placeIcons({ body, kit }: { body: string; kit: TextKit }): string {
  if (!body.includes('class="mm-icon"')) return body
  let out = ''
  let last = 0
  for (const match of body.matchAll(TEXT)) {
    if (!match[2].includes('class="mm-icon"')) continue
    out += body.slice(last, match.index) + layText({ open: match[1], body: match[2], kit })
    last = match.index + match[0].length
  }
  return out + body.slice(last)
}

function distance({ a, b }: { a: string; b: string }): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const above = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1))
      diagonal = above
    }
  }
  return row[b.length]
}

/** Up to three known icon names near an unknown one, for a fix-it message. */
export function nearestIcons(name: string): string[] {
  const names = [...Object.keys(lucide.icons), ...Object.keys(lucide.aliases ?? {})]
  const close = names
    .map((known) => ({ known, d: distance({ a: name, b: known }) }))
    .filter((s) => s.d <= 2)
    .sort((a, b) => a.d - b.d)
    .map((s) => s.known)
  const containing = names.filter((known) => known.split('-').includes(name))
  return [...new Set([...close, ...containing])].slice(0, 3)
}

/** A warning for every `:name:` in the source that names no icon, with the nearest real ones. */
export function iconDiagnostics(source: string): Diagnostic[] {
  return source.split('\n').flatMap((line, i) =>
    Array.from(line.replace(/(^|\s)%%.*$/, '').matchAll(TOKEN))
      .filter((match) => !iconBody(match[1]))
      .map((match) => {
        const near = nearestIcons(match[1])
        const hint = near.length ? ` Did you mean ${near.map((x) => `:${x}:`).join(', ')}?` : ''
        return {
          line: i + 1,
          message: `:${match[1]}: is not a Lucide icon, so it's drawn as text.${hint} Names are at lucide.dev/icons.`,
          severity: 'warning' as const,
        }
      }),
  )
}
