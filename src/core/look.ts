import type { Tokens } from '../theme/index.ts'
import { h } from './svg.ts'

/**
 * Filters shared by every diagram. Diagrams opt in with `filter="url(#mm-…)"`; the organic look
 * adds paper grain to the canvas. All are subtle on purpose: strong texture reads as a gimmick.
 */
export function lookDefs({ tokens, seed }: { tokens: Tokens; seed: number }): string {
  const s = seed % 1000
  return [
    h(
      'filter',
      { id: 'mm-grain', x: 0, y: 0, width: '100%', height: '100%' },
      h('feTurbulence', {
        type: 'fractalNoise',
        baseFrequency: 0.9,
        numOctaves: 2,
        seed: s,
        result: 'noise',
      }),
      h('feColorMatrix', {
        type: 'matrix',
        values: tokens.dark
          ? '0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.05 0'
          : '0 0 0 0 0.3  0 0 0 0 0.25  0 0 0 0 0.1  0 0 0 0.07 0',
      }),
    ),
    h(
      'filter',
      { id: 'mm-ink', x: '-5%', y: '-5%', width: '110%', height: '110%' },
      h('feTurbulence', {
        type: 'fractalNoise',
        baseFrequency: 0.04,
        numOctaves: 2,
        seed: s + 1,
        result: 'warp',
      }),
      h('feDisplacementMap', {
        in: 'SourceGraphic',
        in2: 'warp',
        scale: 2.5,
        xChannelSelector: 'R',
        yChannelSelector: 'G',
      }),
    ),
    h(
      'filter',
      { id: 'mm-shadow', x: '-20%', y: '-20%', width: '140%', height: '160%' },
      h('feDropShadow', {
        dx: 0,
        dy: 1.5,
        stdDeviation: 2,
        'flood-color': tokens.dark ? '#000000' : tokens.fg,
        'flood-opacity': tokens.dark ? 0.35 : 0.08,
      }),
    ),
  ].join('')
}

/** A grain layer over the whole canvas, for the organic look. */
export function grainLayer({ width, height }: { width: number; height: number }): string {
  return h('rect', { width, height, filter: 'url(#mm-grain)', 'pointer-events': 'none' })
}
