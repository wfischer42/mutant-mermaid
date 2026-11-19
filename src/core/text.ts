import { type FontId, WEIGHT } from '../theme/index.ts'
import { mayHaveIcon, widthWithIcons } from './icons.ts'
import { dmSans } from './metrics/dmSans.ts'
import { figtree } from './metrics/figtree.ts'
import { inter } from './metrics/inter.ts'
import { nunito } from './metrics/nunito.ts'
import { plex } from './metrics/plex.ts'
import { sourceSans } from './metrics/sourceSans.ts'
import type { FontMetrics } from './metrics/types.ts'

/** Lines may break after a space, slash or hyphen, but not a hyphen inside an `:icon-name:`. */
const BREAK_AFTER = /(?<=[\s/]|(?<!:[a-z0-9-]*)-)/

const FONTS: Record<FontId, FontMetrics> = {
  nunito,
  inter,
  plex,
  'dm-sans': dmSans,
  'source-sans': sourceSans,
  figtree,
}

export interface TextStyle {
  size: number
  weight?: number
}

/** Measures and wraps text from width tables, the same in a browser and in Node. */
export interface TextKit {
  family: string
  metrics: FontMetrics
  width(text: string, style: TextStyle): number
  /** Breaks text into lines no wider than `max`, at spaces, hyphens and slashes. */
  wrap(text: string, style: TextStyle & { max: number }): string[]
  /** Baseline-to-baseline distance. */
  lineHeight(style: TextStyle): number
  /** How far below a line's center its baseline sits, for vertically centered text. */
  baselineShift(style: TextStyle): number
}

function nearestWeight({
  metrics,
  weight,
}: {
  metrics: FontMetrics
  weight: number
}): Record<string, number> {
  const available = Object.keys(metrics.weights).map(Number)
  const best = available.reduce((a, b) => (Math.abs(b - weight) < Math.abs(a - weight) ? b : a))
  return metrics.weights[best]
}

/** Emoji, symbols and pictographs the tables don't cover, drawn about one em wide. */
function isWide(cp: number): boolean {
  return (
    (cp >= 0x1f000 && cp <= 0x1faff) ||
    (cp >= 0x2600 && cp <= 0x27bf) ||
    (cp >= 0x2b00 && cp <= 0x2bff)
  )
}

function isZeroWidth(cp: number): boolean {
  return (
    cp === 0x200d ||
    (cp >= 0xfe00 && cp <= 0xfe0f) ||
    (cp >= 0x1f3fb && cp <= 0x1f3ff) ||
    cp === 0x20e3
  )
}

/** Width in em of a character the tables don't have. */
function fallback(cp: number): number {
  if (isWide(cp)) return 1.2
  if (cp > 0x2e80) return 1
  return 0.6
}

/**
 * Text at WEIGHT.heading and up is measured in the heading font, as the SVG's stylesheet draws it
 * (see `headingCss`).
 */
export function textKit({
  font,
  family,
  heading = font,
}: {
  font: FontId
  family: string
  heading?: FontId
}): TextKit {
  const metrics = FONTS[font] ?? nunito
  const headingMetrics = FONTS[heading] ?? metrics
  const cache = new Map<number, Record<string, number>>()
  const table = (weight: number) => {
    let found = cache.get(weight)
    if (!found) {
      const source = weight >= WEIGHT.heading ? headingMetrics : metrics
      found = nearestWeight({ metrics: source, weight })
      cache.set(weight, found)
    }
    return found
  }
  const width: TextKit['width'] = (text, style) =>
    mayHaveIcon(text)
      ? widthWithIcons({ line: text, size: style.size, measure: (part) => glyphWidth(part, style) })
      : glyphWidth(text, style)
  const glyphWidth: TextKit['width'] = (text, { size, weight = 400 }) => {
    const widths = table(weight)
    let em = 0
    for (const char of text) {
      const cp = char.codePointAt(0) ?? 32
      if (isZeroWidth(cp)) continue
      em += widths[cp] ?? fallback(cp)
    }
    return em * size
  }
  const wrap: TextKit['wrap'] = (text, { max, ...style }) => {
    const lines: string[] = []
    for (const paragraph of text.split(/\n|\\n/)) {
      const words = paragraph.split(BREAK_AFTER)
      let line = ''
      for (const word of words) {
        const next = line + word
        if (line && width(next.trimEnd(), style) > max) {
          lines.push(line.trimEnd())
          line = word.trimStart()
        } else line = next
      }
      lines.push(line.trimEnd())
    }
    return lines
  }
  return {
    family,
    metrics,
    width,
    wrap,
    lineHeight({ size }) {
      return size * 1.25
    },
    baselineShift({ size }) {
      return size * (metrics.capHeight / 2)
    },
  }
}

/** Splits a label into balanced lines when it's long, so boxes stay compact. */
export function balance({
  kit,
  text,
  style,
  max,
}: {
  kit: TextKit
  text: string
  style: TextStyle
  max: number
}): string[] {
  const full = kit.width(text, style)
  if (full <= max && !/\n|\\n/.test(text)) return [text]
  const count = Math.ceil(full / max)
  return kit.wrap(text, { ...style, max: Math.max(full / count + style.size, style.size * 4) })
}
