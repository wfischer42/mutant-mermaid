/** Tiny string-based SVG building: no DOM, so it runs the same in Node and the browser. */
import { iconPlaceholder, mayHaveIcon, splitIcons } from './icons.ts'

export type Attrs = Record<string, string | number | undefined | null | false>

export function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** A number rounded to two decimals, the precision SVG output needs. */
export function n(value: number): string {
  if (!Number.isFinite(value)) return '0'
  return String(Math.round(value * 100) / 100)
}

function attrs(values: Attrs): string {
  let out = ''
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === false) continue
    out += ` ${key}="${typeof value === 'number' ? n(value) : esc(value)}"`
  }
  return out
}

/** An element; children are markup strings already built. */
export function h(
  tag: string,
  values: Attrs = {},
  ...children: (string | false | null | undefined)[]
): string {
  const body = children.filter(Boolean).join('')
  return body ? `<${tag}${attrs(values)}>${body}</${tag}>` : `<${tag}${attrs(values)}/>`
}

/** A group translated to (x, y). */
export function g(
  { x = 0, y = 0, ...rest }: Attrs & { x?: number; y?: number },
  ...children: (string | false | null | undefined)[]
): string {
  const transform = x || y ? `translate(${n(x)} ${n(y)})` : undefined
  return h('g', { transform, ...rest }, ...children)
}

/** Font stack for emoji runs. Node's PNG output swaps it for the bundled Noto Emoji. */
export const EMOJI_FAMILY =
  "'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji','Noto Emoji',sans-serif"

const EMOJI = /(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}])*)/u

/**
 * A line of text as escaped markup, with emoji in their own spans on an emoji font, so a renderer
 * without emoji in the main font doesn't swap the whole line onto a fallback.
 */
export function runs(line: string): string {
  if (mayHaveIcon(line))
    return splitIcons(line)
      .map((part) => ('icon' in part ? iconPlaceholder(part.icon) : emojiRuns(part.text)))
      .join('')
  return emojiRuns(line)
}

function emojiRuns(line: string): string {
  if (!EMOJI.test(line)) return esc(line)
  return line
    .split(EMOJI)
    .map((part, i) => (i % 2 ? h('tspan', { 'font-family': EMOJI_FAMILY }, esc(part)) : esc(part)))
    .join('')
}

export interface TextOptions {
  x: number
  y: number
  lines: string[]
  size: number
  weight?: number
  fill: string
  anchor?: 'start' | 'middle' | 'end'
  lineHeight: number
  /** Distance from a line's center down to its baseline. */
  shift: number
  /** Whether y is the center of the whole block (default) or the first baseline. */
  valign?: 'middle' | 'top'
  extra?: Attrs
}

/**
 * Multi-line text placed by baseline arithmetic rather than dominant-baseline, which WebKit and
 * resvg each treat differently.
 */
export function text({
  x,
  y,
  lines,
  size,
  weight,
  fill,
  anchor = 'middle',
  lineHeight,
  shift,
  valign = 'middle',
  extra = {},
}: TextOptions): string {
  const top = valign === 'middle' ? y - ((lines.length - 1) * lineHeight) / 2 + shift : y
  const spans = lines.map((line, i) => h('tspan', { x, y: top + i * lineHeight }, runs(line)))
  return h(
    'text',
    {
      'font-size': size,
      'font-weight': weight && weight !== 400 ? weight : undefined,
      fill,
      'text-anchor': anchor,
      ...extra,
    },
    ...spans,
  )
}

export interface DocumentOptions {
  width: number
  height: number
  body: string
  defs?: string
  css?: string
  background?: string
  family: string
  /** Family for text at heading weight and up; the body family when left out. */
  heading?: string
  title?: string
  kind: string
  scroll?: 'x' | 'y'
}

/**
 * Sets heading-weight text in its own family. Weight is the role: everything drawn at
 * WEIGHT.heading or heavier is a title or heading, and the text kit measures it the same way.
 */
export function headingCss({ family, heading }: { family: string; heading?: string }): string {
  if (!heading || heading === family) return ''
  const selector = [600, 700, 800, 900].map((w) => `text[font-weight="${w}"]`).join(',')
  return `${selector}{font-family:${heading}}`
}

export function svgDocument({
  width,
  height,
  body,
  defs,
  css,
  background,
  family,
  heading,
  title,
  kind,
  scroll,
}: DocumentOptions): string {
  const style = `svg{font-family:${family}}${headingCss({ family, heading })}${css ?? ''}`
  return h(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      viewBox: `0 0 ${n(width)} ${n(height)}`,
      width: Math.ceil(width),
      height: Math.ceil(height),
      role: 'img',
      'data-kind': kind,
      'data-scroll': scroll,
      'font-family': family,
    },
    title ? h('title', {}, esc(title)) : '',
    h('style', {}, style),
    defs ? h('defs', {}, defs) : '',
    background ? h('rect', { width: '100%', height: '100%', fill: background }) : '',
    body,
  )
}
