import { type Point, roundedPolygon, roundedRect } from '../../core/geometry.ts'
import { n } from '../../core/svg.ts'
import { corner, type Tokens } from '../../theme/index.ts'
import type { Direction, Shape } from './model.ts'

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

const ROUND = new Set<Shape>(['circle', 'doublecircle', 'start', 'end'])

/** How big a node of `shape` must be to hold a text block of `tw` × `th`. */
export function shapeSize({
  shape,
  tw,
  th,
  direction,
}: {
  shape: Shape
  tw: number
  th: number
  direction: Direction
}): { w: number; h: number } {
  const padX = 20
  const h = Math.max(42, th + 22)
  switch (shape) {
    case 'start':
      return { w: 18, h: 18 }
    case 'end':
      return { w: 22, h: 22 }
    case 'fork':
      return direction === 'LR' || direction === 'RL' ? { w: 8, h: 64 } : { w: 64, h: 8 }
    case 'choice':
      return { w: 30, h: 30 }
    case 'circle': {
      const d = Math.max(48, Math.hypot(tw, th) + 18)
      return { w: d, h: d }
    }
    case 'doublecircle': {
      const d = Math.max(56, Math.hypot(tw, th) + 28)
      return { w: d, h: d }
    }
    case 'diamond': {
      const ratio = 1.5
      const a = tw / 2 + (th * ratio) / 2 + 14
      return { w: a * 2, h: Math.max(56, (a * 2) / ratio) }
    }
    case 'hexagon':
      return { w: tw + padX * 2 + h * 0.5, h }
    case 'stadium':
      return { w: tw + h * 0.9, h }
    case 'subroutine':
      return { w: tw + padX * 2 + 16, h }
    case 'cylinder':
      return { w: Math.max(tw + padX * 2, 64), h: h + 14 }
    case 'flag':
      return { w: tw + padX * 2 + 14, h }
    case 'parallelogram':
    case 'parallelogramAlt':
    case 'trapezoid':
    case 'trapezoidAlt':
      return { w: tw + padX * 2 + h * 0.7, h }
    case 'note':
      return { w: tw + 28, h: Math.max(36, th + 20) }
    default:
      return { w: Math.max(tw + padX * 2, 72), h }
  }
}

/** The corner points of the polygonal shapes, inside their box. */
function polygonPoints({ shape, box }: { shape: Shape; box: Box }): Point[] | null {
  const { x, y, w, h } = box
  const s = h * 0.35
  switch (shape) {
    case 'diamond':
    case 'choice':
      return [
        { x: x + w / 2, y },
        { x: x + w, y: y + h / 2 },
        { x: x + w / 2, y: y + h },
        { x, y: y + h / 2 },
      ]
    case 'hexagon': {
      const k = h * 0.25
      return [
        { x: x + k, y },
        { x: x + w - k, y },
        { x: x + w, y: y + h / 2 },
        { x: x + w - k, y: y + h },
        { x: x + k, y: y + h },
        { x, y: y + h / 2 },
      ]
    }
    case 'parallelogram':
      return [
        { x: x + s, y },
        { x: x + w, y },
        { x: x + w - s, y: y + h },
        { x, y: y + h },
      ]
    case 'parallelogramAlt':
      return [
        { x, y },
        { x: x + w - s, y },
        { x: x + w, y: y + h },
        { x: x + s, y: y + h },
      ]
    case 'trapezoid':
      return [
        { x: x + s, y },
        { x: x + w - s, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
      ]
    case 'trapezoidAlt':
      return [
        { x, y },
        { x: x + w, y },
        { x: x + w - s, y: y + h },
        { x: x + s, y: y + h },
      ]
    case 'flag':
      return [
        { x, y },
        { x: x + w, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
        { x: x + 14, y: y + h / 2 },
      ]
    default:
      return null
  }
}

function ellipse({ box, count = 32 }: { box: Box; count?: number }): Point[] {
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  return Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2
    return { x: cx + (Math.cos(a) * box.w) / 2, y: cy + (Math.sin(a) * box.h) / 2 }
  })
}

function stadiumPoints(box: Box): Point[] {
  const r = box.h / 2
  const out: Point[] = []
  for (let i = 0; i <= 12; i++) {
    const a = -Math.PI / 2 + (i / 12) * Math.PI
    out.push({ x: box.x + box.w - r + Math.cos(a) * r, y: box.y + r + Math.sin(a) * r })
  }
  for (let i = 0; i <= 12; i++) {
    const a = Math.PI / 2 + (i / 12) * Math.PI
    out.push({ x: box.x + r + Math.cos(a) * r, y: box.y + r + Math.sin(a) * r })
  }
  return out
}

/** The node's outline as a polygon, for clipping edges where they meet it. */
export function outline({ shape, box }: { shape: Shape; box: Box }): Point[] {
  const polygon = polygonPoints({ shape, box })
  if (polygon) return polygon
  if (ROUND.has(shape)) return ellipse({ box })
  if (shape === 'stadium') return stadiumPoints(box)
  const { x, y, w, h } = box
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ]
}

/** Where the label sits inside the shape: a cylinder's text drops below its lid. */
export function labelCenter({ shape, box }: { shape: Shape; box: Box }): Point {
  const lid = shape === 'cylinder' ? 7 : 0
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 + lid }
}

function cylinder(box: Box): { body: string; rim: string } {
  const { x, y, w, h } = box
  const rx = w / 2
  const ry = 7
  return {
    body:
      `M${n(x)} ${n(y + ry)}A${n(rx)} ${n(ry)} 0 0 1 ${n(x + w)} ${n(y + ry)}` +
      `V${n(y + h - ry)}A${n(rx)} ${n(ry)} 0 0 1 ${n(x)} ${n(y + h - ry)}Z`,
    rim: `M${n(x)} ${n(y + ry)}A${n(rx)} ${n(ry)} 0 0 0 ${n(x + w)} ${n(y + ry)}`,
  }
}

function circlePath({ box, inset = 0 }: { box: Box; inset?: number }): string {
  const r = box.w / 2 - inset
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  return `M${n(cx - r)} ${n(cy)}A${n(r)} ${n(r)} 0 1 0 ${n(cx + r)} ${n(cy)}A${n(r)} ${n(r)} 0 1 0 ${n(cx - r)} ${n(cy)}Z`
}

function notePath(box: Box): { body: string; fold: string } {
  const { x, y, w, h } = box
  const f = 10
  return {
    body: `M${n(x)} ${n(y)}H${n(x + w - f)}L${n(x + w)} ${n(y + f)}V${n(y + h)}H${n(x)}Z`,
    fold: `M${n(x + w - f)} ${n(y)}V${n(y + f)}H${n(x + w)}`,
  }
}

/**
 * The paths that draw a shape: `body` is filled and stroked; `detail` lines (a cylinder's rim, a
 * subroutine's bars, a double circle's inner ring) are stroked only.
 */
export function shapePaths({ shape, box, tokens }: { shape: Shape; box: Box; tokens: Tokens }): {
  body: string
  detail?: string
} {
  const { x, y, w, h } = box
  const polygon = polygonPoints({ shape, box })
  const bend = (r: number) => corner({ tokens, r })
  if (polygon)
    return { body: roundedPolygon({ points: polygon, r: bend(shape === 'flag' ? 3 : 5) }) }
  switch (shape) {
    case 'rounded':
      return { body: roundedRect({ x, y, w, h, r: Math.min(14, h / 2.6) }) }
    case 'stadium':
      return { body: roundedRect({ x, y, w, h, r: h / 2 }) }
    case 'subroutine':
      return {
        body: roundedRect({ x, y, w, h, r: bend(3) }),
        detail: `M${n(x + 9)} ${n(y)}V${n(y + h)}M${n(x + w - 9)} ${n(y)}V${n(y + h)}`,
      }
    case 'cylinder': {
      const c = cylinder(box)
      return { body: c.body, detail: c.rim }
    }
    case 'circle':
    case 'start':
      return { body: circlePath({ box }) }
    case 'doublecircle':
    case 'end':
      return { body: circlePath({ box }), detail: circlePath({ box, inset: 5 }) }
    case 'fork':
      return { body: roundedRect({ x, y, w, h, r: Math.min(w, h) / 2 }) }
    case 'note': {
      const note = notePath(box)
      return { body: note.body, detail: note.fold }
    }
    default:
      return { body: roundedRect({ x, y, w, h, r: bend(5) }) }
  }
}
