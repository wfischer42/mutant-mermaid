import { define, type Registered } from '../../core/types.ts'
import { canvas } from './canvas.ts'
import { compare } from './compare.ts'
import { cycle } from './cycle.ts'
import { layers } from './layers.ts'
import { matrix } from './matrix.ts'
import { pyramid } from './pyramid.ts'
import { spectrum } from './spectrum.ts'

/**
 * Slot-filling scenes: pyramids, cycles, layer stacks, matrices, canvases,
 * comparisons and spectrums.
 */
export const templateTypes: Registered[] = [
  define(pyramid),
  define(cycle),
  define(layers),
  define(matrix),
  define(canvas),
  define(compare),
  define(spectrum),
]
