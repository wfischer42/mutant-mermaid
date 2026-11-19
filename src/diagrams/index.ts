import { register } from '../core/render.ts'
import { flowTypes } from './flow/index.ts'
import { mindmapTypes } from './mindmap/index.ts'
import { systemsTypes } from './systems/index.ts'
import { templateTypes } from './templates/index.ts'
import { timelineTypes } from './timeline/index.ts'
import { wireframeTypes } from './wireframe/index.ts'

/** Every built-in diagram type. Importing this module registers them. */
export const BUILT_IN = [
  ...templateTypes,
  ...mindmapTypes,
  ...systemsTypes,
  ...timelineTypes,
  ...flowTypes,
  ...wireframeTypes,
]

for (const type of BUILT_IN) register(type)
