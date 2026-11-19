import { converter, formatHex, toGamut } from 'culori'

const toRgb = toGamut('rgb', 'oklch')
const toOklch = converter('oklch')

export interface Oklch {
  l: number
  c: number
  h: number
}

/** An OKLCH color as hex, pulled into the sRGB gamut by lowering chroma rather than clipping. */
export function oklch({ l, c, h }: Oklch): string {
  return formatHex(toRgb({ mode: 'oklch', l, c, h })) ?? '#000000'
}

/** The OKLCH coordinates of any CSS color, or null when it can't be parsed. */
export function parseOklch(color: string): Oklch | null {
  const parsed = toOklch(color)
  if (!parsed) return null
  return { l: parsed.l, c: parsed.c, h: parsed.h ?? 0 }
}

/** Mixes two hex colors in OKLab, `amount` of the way from `from` to `to`. */
export function mix({ from, to, amount }: { from: string; to: string; amount: number }): string {
  const a = toOklab(from)
  const b = toOklab(to)
  return (
    formatHex(
      toRgb({
        mode: 'oklab',
        l: a.l + (b.l - a.l) * amount,
        a: a.a + (b.a - a.a) * amount,
        b: a.b + (b.b - a.b) * amount,
      }),
    ) ?? from
  )
}

const toLab = converter('oklab')
function toOklab(color: string) {
  return toLab(color) ?? { mode: 'oklab' as const, l: 0, a: 0, b: 0 }
}

/** The same color with an alpha channel, as #rrggbbaa. */
export function alpha({ color, amount }: { color: string; amount: number }): string {
  const byte = Math.round(Math.max(0, Math.min(1, amount)) * 255)
  return `${color.slice(0, 7)}${byte.toString(16).padStart(2, '0')}`
}
