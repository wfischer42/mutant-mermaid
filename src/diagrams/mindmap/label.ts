import { text } from '../../core/svg.ts'
import type { TextKit } from '../../core/text.ts'

const LEADING_EMOJI =
  /^(\p{Extended_Pictographic}(?:️|⃣|[\u{1F3FB}-\u{1F3FF}]|‍\p{Extended_Pictographic}️?)*)\s*/u

/** A leading emoji split from the words after it, so each can be drawn as its own run. */
export function splitEmoji(line: string): { emoji: string; rest: string } {
  const m = LEADING_EMOJI.exec(line)
  if (!m) return { emoji: '', rest: line }
  return { emoji: m[1], rest: line.slice(m[0].length) }
}

/**
 * Wraps to no more lines than plain wrapping at `max` needs, but as evenly as possible: the
 * narrowest width that keeps that line count, so no line ends up with a lone word.
 */
export function wrapEven({
  kit,
  text: words,
  style,
  max,
}: {
  kit: TextKit
  text: string
  style: { size: number; weight?: number }
  max: number
}): string[] {
  const loose = kit.wrap(words, { ...style, max })
  if (loose.length < 2) return loose
  let lo = style.size * 3
  let hi = max
  for (let step = 0; step < 14; step++) {
    const mid = (lo + hi) / 2
    if (kit.wrap(words, { ...style, max: mid }).length > loose.length) lo = mid
    else hi = mid
  }
  return kit.wrap(words, { ...style, max: hi })
}

export interface LabelOptions {
  kit: TextKit
  x: number
  y: number
  lines: string[]
  size: number
  weight?: number
  fill: string
  anchor?: 'start' | 'middle' | 'end'
}

function leftEdge({ x, width, anchor }: { x: number; width: number; anchor: string }): number {
  if (anchor === 'start') return x
  if (anchor === 'end') return x - width
  return x - width / 2
}

/**
 * Multi-line text centred on `y`, like `text()` from core, except that a line's leading emoji is
 * drawn as a separate element: renderers without a colour-emoji font (resvg) otherwise switch the
 * whole element to a fallback font, and the label's words turn to boxes.
 */
export function label({
  kit,
  x,
  y,
  lines,
  size,
  weight,
  fill,
  anchor = 'middle',
}: LabelOptions): string {
  const style = { size, weight }
  const lineHeight = kit.lineHeight(style)
  const first = y - ((lines.length - 1) * lineHeight) / 2 + kit.baselineShift(style)
  const common = { size, weight, fill, lineHeight, shift: 0, valign: 'top' as const }
  return lines
    .map((line, i) => {
      const baseline = first + i * lineHeight
      const { emoji, rest } = splitEmoji(line)
      if (!emoji) return text({ ...common, x, y: baseline, lines: [line], anchor })
      const emojiW = kit.width(emoji, style)
      const gap = size * 0.3
      const total = emojiW + (rest ? gap + kit.width(rest, style) : 0)
      const left = leftEdge({ x, width: total, anchor })
      return [
        text({ ...common, x: left, y: baseline, lines: [emoji], anchor: 'start' }),
        rest &&
          text({ ...common, x: left + emojiW + gap, y: baseline, lines: [rest], anchor: 'start' }),
      ].join('')
    })
    .join('')
}
