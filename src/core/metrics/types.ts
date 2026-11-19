export interface FontMetrics {
  id: string
  /** In em, positive up. */
  ascent: number
  /** In em, negative (below the baseline). */
  descent: number
  capHeight: number
  xHeight: number
  /** Advance width in em, by weight, then by code point. */
  weights: Record<number, Record<string, number>>
}
