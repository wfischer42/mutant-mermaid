import { define, type Registered } from '../../core/types.ts'
import { argue } from './argue.ts'
import { issues } from './issues.ts'
import { mindmap } from './mindmap.ts'

/** Organic mind maps and their relatives: concept maps, argument maps, issue trees. */
export const mindmapTypes: Registered[] = [define(mindmap), define(argue), define(issues)]
