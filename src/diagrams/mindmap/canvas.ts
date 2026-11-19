import { g } from '../../core/svg.ts'
import type { Drawing } from '../../core/types.ts'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** The smallest rectangle around everything drawn so far, grown with `add`. */
export class Bounds {
  x0 = Number.POSITIVE_INFINITY
  y0 = Number.POSITIVE_INFINITY
  x1 = Number.NEGATIVE_INFINITY
  y1 = Number.NEGATIVE_INFINITY

  add({ x, y, w = 0, h = 0 }: { x: number; y: number; w?: number; h?: number }): void {
    this.x0 = Math.min(this.x0, x)
    this.y0 = Math.min(this.y0, y)
    this.x1 = Math.max(this.x1, x + w)
    this.y1 = Math.max(this.y1, y + h)
  }

  /** Wraps body markup drawn in free coordinates into a drawing with a margin all round. */
  drawing({ body, margin, title }: { body: string; margin: number; title?: string }): Drawing {
    const empty = !Number.isFinite(this.x0)
    const x0 = empty ? 0 : this.x0
    const y0 = empty ? 0 : this.y0
    const w = empty ? 0 : this.x1 - this.x0
    const h = empty ? 0 : this.y1 - this.y0
    return {
      width: w + margin * 2,
      height: h + margin * 2,
      body: g({ x: margin - x0, y: margin - y0 }, body),
      title,
    }
  }
}

/** A rounded corner path from a vertical spine into a horizontal stub, for bracket connectors. */
export function elbow({
  x,
  y,
  toX,
  toY,
  r,
}: {
  x: number
  y: number
  toX: number
  toY: number
  r: number
}): { d: string; startY: number } {
  const dy = toY - y
  const rr = Math.min(r, Math.abs(dy), Math.abs(toX - x))
  if (rr < 0.5) return { d: `M${x} ${toY}H${toX}`, startY: toY }
  const startY = toY - Math.sign(dy) * rr
  return {
    d: `M${round(x)} ${round(startY)}Q${round(x)} ${round(toY)} ${round(x + Math.sign(toX - x) * rr)} ${round(toY)}H${round(toX)}`,
    startY,
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
